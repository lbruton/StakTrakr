import { test, expect } from "@playwright/test";

/**
 * Playwright TDD spec for STAK-559 — Edit/Add Modal layout reorder.
 *
 * Test coverage:
 *   1.1 imageUploadGroup precedes Name/Year row in DOM order
 *   1.2 Image section exists at top of form (even when hidden in add mode)
 *   2.1 Name/Year row precedes Metal/Type row
 *   3.1 Metal/Type row precedes Purity/Qty/Weight row
 *   4.1–4.3 Goldback unit shows "DENOMINATION" label and visible select
 *   5.1 All other modal fields still present after reorder
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_UUID = "stak559-layout-item";

const BASE_ITEM = {
  uuid: ITEM_UUID,
  metal: "Gold",
  composition: "Gold",
  name: "STAK559 Test Gold Eagle",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 2000,
  marketValue: 0,
  date: "2026-01-01",
  purchaseLocation: "staktrakr.com",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 2000,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.9167,
  numistaId: "",
  serial: 1,
};

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function seedData(page, opts = {}) {
  const { inventory = [BASE_ITEM] } = opts;

  await page.addInitScript(
    ({ inv }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inv));

      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") {
            localStorage.setItem("ackVersion", APP_VERSION);
          }
        },
        { once: true }
      );
    },
    { inv: inventory }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.editItem === "function" &&
      Array.isArray(window.inventory) &&
      window.inventory.length > 0
  );
}

async function openEditForm(page, index = 0) {
  await page.evaluate((idx) => window.editItem(idx), index);
  await expect(page.locator("#itemModal")).toBeVisible();
}

// ---------------------------------------------------------------------------
// Helper: compare DOM order of two selectors within #inventoryForm
// ---------------------------------------------------------------------------

async function getChildIndex(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return -1;
    const parent = el.parentElement;
    if (!parent) return -1;
    return Array.from(parent.children).indexOf(el);
  }, selector);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe("modal-layout — STAK-559 reorder and denomination label", () => {
  // ========================================================================
  // AC 1.1 — Images section precedes Name/Year row
  // ========================================================================
  test("1.1 imageUploadGroup precedes Name/Year row in DOM order", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    const imageIdx = await getChildIndex(page, "#imageUploadGroup");
    const nameYearIdx = await getChildIndex(page, "#inventoryForm > .grid-name-year");

    expect(imageIdx).toBeGreaterThanOrEqual(0);
    expect(nameYearIdx).toBeGreaterThanOrEqual(0);
    expect(imageIdx).toBeLessThan(nameYearIdx);
  });

  // ========================================================================
  // AC 1.2 — Image section exists at top of visible form fields
  // ========================================================================
  test("1.2 image section element exists inside the form", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    const imageGroup = page.locator("#imageUploadGroup");
    await expect(imageGroup).toHaveCount(1);
  });

  // ========================================================================
  // AC 2.1 — Name/Year row precedes Metal/Type row
  // ========================================================================
  test("2.1 Name/Year row precedes Metal/Type row", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    const nameYearIdx = await getChildIndex(page, "#inventoryForm > .grid-name-year");
    // Metal/Type row is the first .grid-2 after hidden fields
    const metalTypeIdx = await page.evaluate(() => {
      const form = document.getElementById("inventoryForm");
      const children = Array.from(form.children);
      return children.findIndex(
        (el) => el.classList.contains("grid-2") && el.querySelector('label[for="itemMetal"]')
      );
    });

    expect(nameYearIdx).toBeGreaterThanOrEqual(0);
    expect(metalTypeIdx).toBeGreaterThanOrEqual(0);
    expect(nameYearIdx).toBeLessThan(metalTypeIdx);
  });

  // ========================================================================
  // AC 3.1 — Metal/Type row precedes Purity/Qty/Weight row
  // ========================================================================
  test("3.1 Metal/Type row precedes Purity/Qty/Weight row", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    const metalTypeIdx = await page.evaluate(() => {
      const form = document.getElementById("inventoryForm");
      const children = Array.from(form.children);
      return children.findIndex(
        (el) => el.classList.contains("grid-2") && el.querySelector('label[for="itemMetal"]')
      );
    });

    const purityIdx = await getChildIndex(page, "#inventoryForm > .grid-purity-row");

    expect(metalTypeIdx).toBeGreaterThanOrEqual(0);
    expect(purityIdx).toBeGreaterThanOrEqual(0);
    expect(metalTypeIdx).toBeLessThan(purityIdx);
  });

  // ========================================================================
  // AC 4.1–4.3 — Goldback unit shows "DENOMINATION" label
  // ========================================================================
  test("4.1–4.3 selecting goldback unit shows DENOMINATION label and visible select", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    // init.js attaches the change listener inside setTimeout (line 655).
    // Ensure Phase 14 listeners are wired before triggering the change event.
    await page.waitForFunction(
      () =>
        typeof toggleGbDenomPicker === "function" && document.getElementById("itemGbDenom") !== null
    );

    // Switch weight unit to goldback — this fires the real change event
    await page.selectOption("#itemWeightUnit", "gb");

    // Label must read "DENOMINATION" (uppercase, matching column headers)
    const weightLabel = page.locator("#itemWeightLabel");
    await expect(weightLabel).toHaveText("DENOMINATION");

    // Denomination select must be visible
    const gbSelect = page.locator("#itemGbDenom");
    await expect(gbSelect).toBeVisible();

    // Weight input must be hidden
    const weightInput = page.locator("#itemWeight");
    await expect(weightInput).toBeHidden();
  });

  // ========================================================================
  // AC 5.1 — All other fields still present after reorder
  // ========================================================================
  test("5.1 all other modal fields are still present", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    await expect(page.locator("#itemName")).toBeVisible();
    await expect(page.locator("#itemYear")).toBeVisible();
    await expect(page.locator("#itemMetal")).toBeVisible();
    await expect(page.locator("#itemType")).toBeVisible();
    await expect(page.locator("#itemPuritySelect")).toBeVisible();
    await expect(page.locator("#itemQty")).toBeVisible();
    await expect(page.locator("#itemWeight")).toBeVisible();
    await expect(page.locator("#itemWeightUnit")).toBeVisible();
    await expect(page.locator("#itemDate")).toBeVisible();
    await expect(page.locator("#itemPrice")).toBeVisible();
    await expect(page.locator("#purchaseLocation")).toBeVisible();
    await expect(page.locator("#storageLocation")).toBeVisible();
    await expect(page.locator("#itemNotes")).toHaveCount(1);
    await expect(page.locator("#newTagInput")).toHaveCount(1);
  });
});

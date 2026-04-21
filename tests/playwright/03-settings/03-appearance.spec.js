import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "../helpers/seed.js";

/**
 * Playwright tests for Settings > Appearance settings
 *
 * STAK-529: Add Sort Direction Toggle to Settings > Appearance
 * STAK-535: Move Metals & Inline Chips settings to Appearance
 * These tests verify the sort direction toggle and moved Metals & Inline Chips settings.
 *
 * TDD Phase: GREEN — Implementation exists in index.html and settings-listeners.js.
 */

/**
 * Helper function to open Appearance settings programmatically
 * @param {Page} page - Playwright page instance
 */
async function openAppearanceSettings(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("site"));

  const settingsModal = page.locator("#settingsModal");
  await expect(settingsModal).toBeVisible();
  await expect(page.locator("#settingsPanel_site")).toBeVisible();
}

test.describe("03-settings/03-appearance — Sort Direction Toggle & Metals Settings", () => {
  test.beforeEach(async ({ page }) => {
    // Seed localStorage to suppress ack modal and What's New popup
    await injectSeedInventory(page);
    // Navigate to Settings > Site (Appearance)
    await page.goto("/index.html");
    await openAppearanceSettings(page);
  });

  test("3.1 — sort direction toggle element exists", async ({ page }) => {
    // Verify the toggle container exists
    const toggle = page.locator("#settingsDefaultSortDir");
    await expect(toggle).toBeVisible();
  });

  test("3.2 — toggle has two buttons with correct structure", async ({ page }) => {
    // Verify two buttons exist with correct class and data attributes
    const buttons = page.locator("#settingsDefaultSortDir .chip-sort-btn");
    await expect(buttons).toHaveCount(2);

    // Verify data-val attributes
    const ascBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="asc"]');
    const descBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="desc"]');

    await expect(ascBtn).toBeVisible();
    await expect(ascBtn).toHaveText("Asc");

    await expect(descBtn).toBeVisible();
    await expect(descBtn).toHaveText("Desc");
  });

  test("3.3 — clicking Asc button sets active class and localStorage", async ({ page }) => {
    // Click the Asc button
    const ascBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="asc"]');
    await ascBtn.click();

    // Verify active class is set
    await expect(ascBtn).toHaveClass(/active/);

    // Verify localStorage is set
    const localStorageValue = await page.evaluate(() => {
      return localStorage.getItem("defaultSortDir");
    });
    expect(localStorageValue).toBe("asc");
  });

  test("3.4 — clicking Desc button sets active class and localStorage", async ({ page }) => {
    // Click the Desc button
    const descBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="desc"]');
    await descBtn.click();

    // Verify active class is set
    await expect(descBtn).toHaveClass(/active/);

    // Verify localStorage is set
    const localStorageValue = await page.evaluate(() => {
      return localStorage.getItem("defaultSortDir");
    });
    expect(localStorageValue).toBe("desc");
  });

  test("3.5 — active class toggles between buttons", async ({ page }) => {
    const ascBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="asc"]');
    const descBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="desc"]');

    // Click Asc — verify it's active, Desc is not
    await ascBtn.click();
    await expect(ascBtn).toHaveClass(/active/);
    await expect(descBtn).not.toHaveClass(/active/);

    // Click Desc — verify it's active, Asc is not
    await descBtn.click();
    await expect(descBtn).toHaveClass(/active/);
    await expect(ascBtn).not.toHaveClass(/active/);

    // Verify localStorage reflects the final selection
    const localStorageValue = await page.evaluate(() => {
      return localStorage.getItem("defaultSortDir");
    });
    expect(localStorageValue).toBe("desc");
  });

  test("3.6 — selection persists across page refresh", async ({ page }) => {
    const descBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="desc"]');
    await descBtn.click();
    await expect(descBtn).toHaveClass(/active/);

    await page.reload();
    await openAppearanceSettings(page);

    const descBtnAfter = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="desc"]');
    await expect(descBtnAfter).toHaveClass(/active/);

    const localStorageValue = await page.evaluate(() => {
      return localStorage.getItem("defaultSortDir");
    });
    expect(localStorageValue).toBe("desc");
  });

  test("3.7 — default selection is Asc on first load", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem("defaultSortDir");
    });

    await page.reload();
    await openAppearanceSettings(page);

    const ascBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="asc"]');
    await expect(ascBtn).toHaveClass(/active/);
  });

  // STAK-535: Regression tests for Metals & Inline Chips in combined fieldset

  test("3.8 — metals config container exists in Appearance", async ({ page }) => {
    const metalConfig = page.locator("#metalOrderConfigContainer");
    await expect(metalConfig).toBeVisible();
  });

  test("3.9 — inline chips config container exists in Appearance", async ({ page }) => {
    const inlineChipConfig = page.locator("#inlineChipConfigContainer");
    await expect(inlineChipConfig).toBeVisible();
  });

  test("3.10 — metals & inline chips share a combined fieldset", async ({ page }) => {
    const fieldset = page.locator('.settings-fieldset:has-text("Metals & Inline Chips")');
    await expect(fieldset).toBeVisible();
    await expect(fieldset.locator("#metalOrderConfigContainer")).toBeVisible();
    await expect(fieldset.locator("#inlineChipConfigContainer")).toBeVisible();
  });

  test("3.11 — metal order config has rows", async ({ page }) => {
    const container = page.locator("#metalOrderConfigContainer");
    await expect(container).toBeVisible();
    const rows = container.locator("tr, .chip-grouping-row");
    await expect(rows).not.toHaveCount(0);
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

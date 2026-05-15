import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

/**
 * Playwright tests for Settings > Appearance settings
 *
 * STAK-563: Appearance tab UI cleanup — flat layout, section reorder, sort toggle replacement
 * Tests verify the icon-button sort direction toggle and Metal Order / Inline Name Chips
 * relocated as flat groups under Layout.
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

test.describe("03-settings/03-appearance — Sort Direction Icon Button & Flat Layout", () => {
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

  test("3.2 — sort button is an icon button with card-sort-dir-btn class and data-dir", async ({
    page,
  }) => {
    const btn = page.locator("#settingsDefaultSortDir");
    await expect(btn).toHaveClass(/card-sort-dir-btn/);
    const dir = await btn.getAttribute("data-dir");
    expect(["asc", "desc"]).toContain(dir);
  });

  test("3.3 — clicking button toggles data-dir from asc to desc and saves localStorage", async ({
    page,
  }) => {
    const btn = page.locator("#settingsDefaultSortDir");
    await expect(btn).toHaveAttribute("data-dir", "asc");

    await btn.click();

    await expect(btn).toHaveAttribute("data-dir", "desc");
    const stored = await page.evaluate(() => localStorage.getItem("defaultSortDir"));
    expect(stored).toBe("desc");
  });

  test("3.4 — clicking twice cycles back to asc and saves localStorage", async ({ page }) => {
    const btn = page.locator("#settingsDefaultSortDir");

    await btn.click();
    await expect(btn).toHaveAttribute("data-dir", "desc");

    await btn.click();
    await expect(btn).toHaveAttribute("data-dir", "asc");

    const stored = await page.evaluate(() => localStorage.getItem("defaultSortDir"));
    expect(stored).toBe("asc");
  });

  test("3.5 — each click alternates direction", async ({ page }) => {
    const btn = page.locator("#settingsDefaultSortDir");

    await btn.click();
    await expect(btn).toHaveAttribute("data-dir", "desc");

    await btn.click();
    await expect(btn).toHaveAttribute("data-dir", "asc");

    await btn.click();
    const stored = await page.evaluate(() => localStorage.getItem("defaultSortDir"));
    expect(stored).toBe("desc");
  });

  test("3.6 — direction persists across page refresh", async ({ page }) => {
    const btn = page.locator("#settingsDefaultSortDir");
    await btn.click();
    await expect(btn).toHaveAttribute("data-dir", "desc");

    await page.reload();
    await openAppearanceSettings(page);

    await expect(page.locator("#settingsDefaultSortDir")).toHaveAttribute("data-dir", "desc");
    const stored = await page.evaluate(() => localStorage.getItem("defaultSortDir"));
    expect(stored).toBe("desc");
  });

  test("3.7 — default data-dir is asc on first load with no localStorage", async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("defaultSortDir"));

    await page.reload();
    await openAppearanceSettings(page);

    await expect(page.locator("#settingsDefaultSortDir")).toHaveAttribute("data-dir", "asc");
  });

  // STAK-563: Metal Order + Inline Name Chips now flat groups under Layout fieldset

  test("3.8 — metals config container exists in Appearance", async ({ page }) => {
    const metalConfig = page.locator("#metalOrderConfigContainer");
    await expect(metalConfig).toBeVisible();
  });

  test("3.9 — inline chips config container exists in Appearance", async ({ page }) => {
    const inlineChipConfig = page.locator("#inlineChipConfigContainer");
    await expect(inlineChipConfig).toBeVisible();
  });

  test("3.10 — metal order and inline chips are flat groups inside the Layout fieldset", async ({
    page,
  }) => {
    const layoutFieldset = page.locator('.settings-fieldset:has-text("Layout")');
    await expect(layoutFieldset).toBeVisible();
    await expect(layoutFieldset.locator("#metalOrderConfigContainer")).toBeVisible();
    await expect(layoutFieldset.locator("#inlineChipConfigContainer")).toBeVisible();
    // Standalone "Metals & Inline Chips" section no longer exists
    await expect(
      page.locator('.settings-fieldset-title:text("Metals & Inline Chips")')
    ).toHaveCount(0);
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

import { test, expect } from '@playwright/test';
import { injectSeedInventory } from '../helpers/seed.js';

/**
 * Playwright tests for Settings > Appearance sort direction toggle
 *
 * STAK-529: Add Sort Direction Toggle to Settings > Appearance
 * These tests verify the toggle for "Asc" and "Desc" sort direction options.
 *
 * TDD Phase: GREEN — Implementation exists in index.html and settings-listeners.js.
 */

test.describe('03-settings/03-appearance — Default Sort Direction Toggle', () => {
  test.beforeEach(async ({ page }) => {
    // Seed localStorage to suppress ack modal and What's New popup
    await injectSeedInventory(page);
    // Navigate to Settings > Site (Appearance)
    await page.goto('/index.html');
    await page.click('#settingsBtn');
    await page.click('[data-section="site"]');
    await expect(page.locator('#settingsPanel_site')).toBeVisible();
  });

  test('3.1 — sort direction toggle element exists', async ({ page }) => {
    // Verify the toggle container exists
    const toggle = page.locator('#settingsDefaultSortDir');
    await expect(toggle).toBeVisible();
  });

  test('3.2 — toggle has two buttons with correct structure', async ({ page }) => {
    // Verify two buttons exist with correct class and data attributes
    const buttons = page.locator('#settingsDefaultSortDir .chip-sort-btn');
    await expect(buttons).toHaveCount(2);

    // Verify data-val attributes
    const ascBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="asc"]');
    const descBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="desc"]');

    await expect(ascBtn).toBeVisible();
    await expect(ascBtn).toHaveText('Asc');

    await expect(descBtn).toBeVisible();
    await expect(descBtn).toHaveText('Desc');
  });

  test('3.3 — clicking Asc button sets active class and localStorage', async ({ page }) => {
    // Click the Asc button
    const ascBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="asc"]');
    await ascBtn.click();

    // Verify active class is set
    await expect(ascBtn).toHaveClass(/active/);

    // Verify localStorage is set
    const localStorageValue = await page.evaluate(() => {
      return localStorage.getItem('defaultSortDir');
    });
    expect(localStorageValue).toBe('asc');
  });

  test('3.4 — clicking Desc button sets active class and localStorage', async ({ page }) => {
    // Click the Desc button
    const descBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="desc"]');
    await descBtn.click();

    // Verify active class is set
    await expect(descBtn).toHaveClass(/active/);

    // Verify localStorage is set
    const localStorageValue = await page.evaluate(() => {
      return localStorage.getItem('defaultSortDir');
    });
    expect(localStorageValue).toBe('desc');
  });

  test('3.5 — active class toggles between buttons', async ({ page }) => {
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
      return localStorage.getItem('defaultSortDir');
    });
    expect(localStorageValue).toBe('desc');
  });

  test('3.6 — selection persists across page refresh', async ({ page }) => {
    // Set initial selection to Desc
    const descBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="desc"]');
    await descBtn.click();

    // Verify it's selected
    await expect(descBtn).toHaveClass(/active/);

    // Refresh the page
    await page.reload();
    await page.click('#settingsBtn');
    await page.click('[data-section="site"]');
    await expect(page.locator('#settingsPanel_site')).toBeVisible();

    // Verify Desc button still has active class after refresh
    const descBtnAfter = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="desc"]');
    await expect(descBtnAfter).toHaveClass(/active/);

    // Verify localStorage still has the value
    const localStorageValue = await page.evaluate(() => {
      return localStorage.getItem('defaultSortDir');
    });
    expect(localStorageValue).toBe('desc');
  });

  test('3.7 — default selection is Asc on first load', async ({ page }) => {
    // Clear localStorage to simulate first load
    await page.evaluate(() => {
      localStorage.removeItem('defaultSortDir');
    });

    // Reload the page
    await page.reload();
    await page.click('#settingsBtn');
    await page.click('[data-section="site"]');
    await expect(page.locator('#settingsPanel_site')).toBeVisible();

    // Verify Asc button has active class by default (init falls back to 'asc')
    const ascBtn = page.locator('#settingsDefaultSortDir .chip-sort-btn[data-val="asc"]');
    await expect(ascBtn).toHaveClass(/active/);
  });
});

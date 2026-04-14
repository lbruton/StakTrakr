import { test, expect } from '@playwright/test';
import { injectSeedInventory } from '../helpers/seed.js';

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
  await page.waitForFunction(() => typeof window.showSettingsModal === 'function');
  await page.evaluate(() => window.showSettingsModal('site'));

  const settingsModal = page.locator('#settingsModal');
  await expect(settingsModal).toBeVisible();
  await expect(page.locator('#settingsPanel_site')).toBeVisible();
}

test.describe('03-settings/03-appearance — Sort Direction Toggle & Metals Settings', () => {
  test.beforeEach(async ({ page }) => {
    // Seed localStorage to suppress ack modal and What's New popup
    await injectSeedInventory(page);
    // Navigate to Settings > Site (Appearance)
    await page.goto('/index.html');
    await openAppearanceSettings(page);
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

  // STAK-535: Regression tests for moved Metals & Inline Chips settings

  test('3.8 — metals section exists in Appearance', async ({ page }) => {
    // Verify the metals fieldset exists
    const metalsFieldset = page.locator('#settingsMetals');
    await expect(metalsFieldset).toBeVisible();
    await expect(metalsFieldset.locator('legend')).toHaveText('Metals');
  });

  test('3.9 — inline chips section exists in Appearance', async ({ page }) => {
    // Verify the inline chips fieldset exists
    const inlineChipsFieldset = page.locator('#settingsInlineChips');
    await expect(inlineChipsFieldset).toBeVisible();
    await expect(inlineChipsFieldset.locator('legend')).toHaveText('Inline Chips');
  });

  test('3.10 — metals toggle enables/disables display', async ({ page }) => {
    // Verify metals toggle exists and works
    const metalsToggle = page.locator('#settingsMetals input[type="checkbox"]');
    await expect(metalsToggle).toBeVisible();
    
    // Toggle on
    await metalsToggle.check();
    expect(await page.evaluate(() => localStorage.getItem('showMetals'))).toBe('true');
    
    // Toggle off
    await metalsToggle.uncheck();
    expect(await page.evaluate(() => localStorage.getItem('showMetals'))).toBe('false');
  });

  test('3.11 — inline chips options persist', async ({ page }) => {
    // Verify inline chips select persists
    const inlineChipsSelect = page.locator('#settingsInlineChips select');
    await expect(inlineChipsSelect).toBeVisible();
    
    // Test different options
    await inlineChipsSelect.selectOption({ label: 'Both' });
    expect(await page.evaluate(() => localStorage.getItem('inlineChipsOption'))).toBe('both');
    
    await inlineChipsSelect.selectOption({ label: 'Top' });
    expect(await page.evaluate(() => localStorage.getItem('inlineChipsOption'))).toBe('top');
    
    await inlineChipsSelect.selectOption({ label: 'Inline' });
    expect(await page.evaluate(() => localStorage.getItem('inlineChipsOption'))).toBe('inline');
  });
});

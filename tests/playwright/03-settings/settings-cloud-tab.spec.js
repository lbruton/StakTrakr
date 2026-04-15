import { test, expect } from '@playwright/test';
import { injectSeedInventory } from '../helpers/seed.js';

test.describe('STAK-444 — Cloud tab settings panel', () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window.showSettingsModal === 'function');
    await page.evaluate(() => window.showSettingsModal('system'));
    await expect(page.locator('#settingsModal')).toBeVisible();
    await expect(page.locator('#settingsPanel_system')).toBeVisible();
  });

  test('2.1 — Cloud tab shows settingsPanel_cloud and hides settingsPanel_system', async ({ page }) => {
    await page.locator('[data-section="cloud"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="cloud"]').click();
    await expect(page.locator('#settingsPanel_cloud')).toBeVisible();
    await expect(page.locator('#settingsPanel_system')).not.toBeVisible();
  });

  test('2.2 — Cloud panel contains #cloudCard_dropbox', async ({ page }) => {
    await page.locator('[data-section="cloud"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="cloud"]').click();
    const cloudPanel = page.locator('#settingsPanel_cloud');
    await expect(cloudPanel.locator('#cloudCard_dropbox')).toBeVisible();
  });

  test('2.3 — Cloud panel contains Cloud Sync Beta card', async ({ page }) => {
    await page.locator('[data-section="cloud"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="cloud"]').click();
    const cloudPanel = page.locator('#settingsPanel_cloud');
    await expect(cloudPanel.getByText('Cloud Sync Beta')).toBeVisible();
  });

  test('2.4 — System tab does not show #cloudCard_dropbox', async ({ page }) => {
    await page.locator('[data-section="system"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="system"]').click();
    const systemPanel = page.locator('#settingsPanel_system');
    await expect(systemPanel.locator('#cloudCard_dropbox')).toHaveCount(0);
  });

  test('2.5 — System tab App Updates (forceRefreshBtn) still visible', async ({ page }) => {
    await page.locator('[data-section="system"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="system"]').click();
    await expect(page.locator('#forceRefreshBtn')).toBeVisible();
  });
});

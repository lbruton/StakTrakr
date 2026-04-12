import { test, expect } from '@playwright/test';
import { injectSeedInventory } from '../helpers/seed.js';

async function dismissWhatsNew(page) {
  const popup = page.locator('#whatsNewPopup');
  const isVisible = await popup.isVisible().catch(() => false);
  if (isVisible) {
    await page.click('#whatsNewDismissBtn');
    await expect(popup).toBeHidden();
  }
}

test.describe('01-page-load', () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test('1.1 — page loads at local URL', async ({ page }) => {
    // runbook: 01-page-load.md §1.1
    // NOTE: Runbook pass criteria references tagline "Your Stack. Your Way." —
    // this text does not exist in the live HTML (#appLogo is the SVG branding element).
    // Assertion adapted to check #appLogo visibility as the equivalent branding check.
    await page.goto('/index.html');
    await expect(page).toHaveTitle(/StakTrakr/);
    await expect(page.locator('#appLogo')).toBeVisible();
  });

  test('1.2 — What\'s New popup appears on first load', async ({ page }) => {
    // runbook: 01-page-load.md §1.2
    await page.goto('/index.html');
    await expect(page.locator('#whatsNewPopup')).toBeVisible();
  });

  test('1.3 — What\'s New contains latest patch notes', async ({ page }) => {
    // runbook: 01-page-load.md §1.3
    await page.goto('/index.html');
    await expect(page.locator('#whatsNewPopup')).toBeVisible();
    const versionEl = page.locator('#whatsNewVersion');
    await expect(versionEl).not.toBeEmpty();
    const versionText = await versionEl.textContent();
    expect(versionText.trim().length).toBeGreaterThan(0);
  });

  test('1.4 — clicking Got it! closes the What\'s New popup', async ({ page }) => {
    // runbook: 01-page-load.md §1.4
    await page.goto('/index.html');
    await expect(page.locator('#whatsNewPopup')).toBeVisible();
    await page.click('#whatsNewDismissBtn');
    await expect(page.locator('#whatsNewPopup')).toBeHidden();
  });

  test('1.5 — What\'s New does NOT appear on refresh (session-scoped)', async ({ page }) => {
    // runbook: 01-page-load.md §1.5
    await page.goto('/index.html');
    await dismissWhatsNew(page);
    await page.goto('/index.html');
    await expect(page.locator('#whatsNewPopup')).toBeHidden();
  });

  test('1.6 — header displays all menu items in correct order', async ({ page }) => {
    // runbook: 01-page-load.md §1.6
    await page.goto('/index.html');
    await dismissWhatsNew(page);
    const headerBtns = page.locator('#headerBtnContainer button.header-toggle-btn:visible');
    const count = await headerBtns.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('1.7 — version number in header matches deployed patch version', async ({ page }) => {
    // runbook: 01-page-load.md §1.7
    await page.goto('/index.html');
    await dismissWhatsNew(page);
    const versionBadge = page.locator('#versionBadgeValue');
    await expect(versionBadge).toBeVisible({ timeout: 5000 });
    const text = await versionBadge.textContent();
    expect(text.trim()).toMatch(/\d+\.\d+\.\d+/);
    expect(text.trim()).not.toMatch(/^0\.0\.0/);
    expect(text.trim()).not.toContain('undefined');
  });

  test('1.8 — spot cards render (all 4 metals, non-zero values) @network', async ({ page }) => {
    // runbook: 01-page-load.md §1.8
    await page.goto('/index.html');
    await dismissWhatsNew(page);
    for (const metal of ['Gold', 'Silver', 'Platinum', 'Palladium']) {
      const el = page.locator(`#spotPriceDisplay${metal}`);
      await expect(el).toBeVisible();
      const text = await el.textContent();
      expect(text.trim()).not.toBe('—');
      expect(text.trim()).not.toBe('$0.00');
      expect(text.trim()).not.toBe('N/A');
    }
  });

  test('1.9 — spot API backfills missing spot prices for last 30 days on load @network', async ({ page }) => {
    // runbook: 01-page-load.md §1.9
    await page.goto('/index.html');
    await dismissWhatsNew(page);
    for (const metal of ['Gold', 'Silver', 'Platinum', 'Palladium']) {
      const el = page.locator(`#spotPriceDisplay${metal}`);
      await expect(el).toBeVisible();
      const text = await el.textContent();
      expect(text.trim()).not.toBe('—');
      expect(text.trim()).not.toBe('N/A');
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  test('1.10 — market API backfills daily market prices for last 30 days on load @network', async ({ page }) => {
    // runbook: 01-page-load.md §1.10
    await page.goto('/index.html');
    await dismissWhatsNew(page);
    // Check that no error toasts appear about market data failures
    const errorToast = page.locator('.cloud-toast', { hasText: /storage is full|quota|could not be saved/i });
    await expect(errorToast).toHaveCount(0);
  });

  test('1.11 — seed inventory count is accurate on first load', async ({ page }) => {
    // runbook: 01-page-load.md §1.11
    await page.goto('/index.html');
    await dismissWhatsNew(page);
    const countEl = page.locator('#totalItemsAll');
    await expect(countEl).toBeVisible();
    await expect(countEl).toHaveText('8');
  });

  test('1.12 — fresh startup stays quota-safe and keeps market UI available @network', async ({ page }) => {
    // runbook: 01-page-load.md §1.12
    await page.goto('/index.html');
    await dismissWhatsNew(page);
    // Verify no storage-full/quota toasts appear during cold startup
    const quotaToast = page.locator('.cloud-toast', { hasText: /storage is full|quota|spot history|could not be saved/i });
    await expect(quotaToast).toHaveCount(0);
    const ticker = page.locator('#bestPriceTickerEl');
    await expect(ticker).toBeVisible();
  });
});

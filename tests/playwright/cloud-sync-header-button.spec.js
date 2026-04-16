import { test, expect } from '@playwright/test';
import { injectSeedInventory } from './helpers/seed.js';

/**
 * STAK-549 — Header cloud sync button silent failure bug.
 *
 * When no vault password is cached, syncNow() aborts silently (returns
 * undefined via resolved promise). The caller's .then() in events.js fires
 * unconditionally and shows a false "Synced" / "Sync complete" toast.
 *
 * These tests MUST FAIL before the fix is applied.
 */

/**
 * Set up localStorage for a fully connected Dropbox state (token, account,
 * password, sync enabled) so the header button renders in sync-capable state
 * and resolveHeaderCloudAction() returns { action: 'sync-now' }.
 */
function setupFullyConnected(page) {
  return page.addInitScript(() => {
    localStorage.setItem('cloud_dropbox_account_id', 'dbid:AABBCCtest123');
    localStorage.setItem('cloud_sync_enabled', 'true');
    localStorage.setItem('cloud_token_dropbox', JSON.stringify({
      access_token: 'sl.test-fake-token',
      expires_at: Date.now() + 3600000,
    }));
    localStorage.setItem('cloud_vault_password', 'test-vault-pw-12345');
  });
}

/**
 * After page load, clear cached password and override resolveHeaderCloudAction
 * to still return sync-now. This simulates the real bug scenario: password was
 * cleared by idle timeout but the header button's stale state still routes to
 * the sync-now branch.
 */
async function simulateStaleButtonState(page) {
  await page.evaluate(() => {
    localStorage.removeItem('cloud_vault_password');
    // Force the sync-now path even though password is gone (stale state)
    window.resolveHeaderCloudAction = function () {
      return { action: 'sync-now', syncCapable: true };
    };
  });
}

/**
 * Collect all cloud-toast text that appears within a timeout window.
 */
async function collectToasts(page, durationMs) {
  return page.evaluate((ms) => {
    return new Promise((resolve) => {
      const texts = [];
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && node.classList.contains('cloud-toast')) {
              texts.push(node.textContent.trim());
            }
          }
        }
      });
      observer.observe(document.body, { childList: true });
      setTimeout(() => { observer.disconnect(); resolve(texts); }, ms);
    });
  }, durationMs);
}

test.describe('STAK-549 — Header cloud sync button silent failure', () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test('shows password modal when no cached password and no false success toast', async ({ page }) => {
    await setupFullyConnected(page);
    await page.goto('/index.html');
    // Wait for init.js Phase 14 listener setup (200ms) to complete
    await page.waitForTimeout(400);

    // Simulate stale button state (password cleared after init)
    await simulateStaleButtonState(page);

    // Start collecting toasts before clicking
    const toastPromise = collectToasts(page, 7000);

    // Click the header cloud button — enters sync-now branch, calls syncNow()
    await page.locator('#headerCloudSyncBtn').click();

    // syncNow() -> getSyncPasswordSilent() returns null -> getSyncPassword() opens modal
    await expect(page.locator('#cloudSyncPasswordModal')).toBeVisible({ timeout: 5000 });

    // Dismiss the modal via the cancel button
    await page.locator('#syncPasswordCancelBtn').click();
    await expect(page.locator('#cloudSyncPasswordModal')).not.toBeVisible({ timeout: 3000 });

    const toasts = await toastPromise;

    // BUG ASSERTION: No false "Synced" / "Sync complete" toast should appear
    // after the password modal was dismissed without entering a password.
    // Before the fix, the .then() fires unconditionally showing a success toast.
    const falseSuccess = toasts.filter(t =>
      /synced|sync complete/i.test(t) && !/syncing/i.test(t)
    );
    expect(falseSuccess).toHaveLength(0);
  });

  test('shows error toast when password modal cancelled', async ({ page }) => {
    await setupFullyConnected(page);
    await page.goto('/index.html');
    await page.waitForTimeout(400);

    // Simulate stale button state
    await simulateStaleButtonState(page);

    // Start collecting toasts before clicking
    const toastPromise = collectToasts(page, 7000);

    // Click header cloud button -> syncNow() -> password modal
    await page.locator('#headerCloudSyncBtn').click();
    await expect(page.locator('#cloudSyncPasswordModal')).toBeVisible({ timeout: 5000 });

    // Cancel the password modal via the cancel button
    await page.locator('#syncPasswordCancelBtn').click();
    await expect(page.locator('#cloudSyncPasswordModal')).not.toBeVisible({ timeout: 3000 });

    const toasts = await toastPromise;

    // BUG ASSERTION 1: Should see the "requires a vault password" error toast.
    // syncNow() does emit showCloudToast('Cloud sync requires a vault password.')
    // when pw is null after cancel — but the caller's .then() overwrites it
    // with a false "Synced" / "Sync complete" success toast.
    const errorToast = toasts.filter(t =>
      /vault password/i.test(t)
    );
    expect(errorToast.length).toBeGreaterThanOrEqual(1);

    // BUG ASSERTION 2: Should NOT see any false success toast after cancel.
    // Before the fix, events.js .then() fires and shows "Synced" / "Sync complete".
    const falseSuccess = toasts.filter(t =>
      /synced|sync complete/i.test(t) && !/syncing/i.test(t)
    );
    expect(falseSuccess).toHaveLength(0);
  });

  test('shows synced toast when password is cached (regression guard)', async ({ page }) => {
    // Full connected state with password cached — no stale state
    await setupFullyConnected(page);
    await page.goto('/index.html');
    await page.waitForTimeout(400);

    // Start collecting toasts
    const toastPromise = collectToasts(page, 8000);

    // Click header cloud button — should trigger syncNow with password present
    await page.locator('#headerCloudSyncBtn').click();

    const toasts = await toastPromise;

    // With password cached, the sync pathway should fire.
    // The actual Dropbox sync will fail (no real token), so we may see
    // "Sync failed" or "Synced" depending on error handling.
    // The key regression guard: the toast pathway DOES fire (not silent).
    // We accept "Syncing", "Synced", "Sync complete", or "Sync failed" —
    // any of these proves the toast pathway is active.
    const syncToasts = toasts.filter(t =>
      /sync/i.test(t)
    );
    expect(syncToasts.length).toBeGreaterThanOrEqual(1);
  });
});

import { test, expect } from "./helpers/mocks/extended-test.js";
import { injectSeedInventory } from "./helpers/seed.js";

/**
 * STAK-549 — Header cloud sync button: syncNow() return contract and toast behavior.
 *
 * Verifies the fix: syncNow() returns { synced: false } when no password,
 * and the events.js handler checks result.synced before showing success toast.
 */

function setupFullyConnected(page) {
  return page.addInitScript(() => {
    localStorage.setItem("cloud_dropbox_account_id", "dbid:AABBCCtest123");
    localStorage.setItem("cloud_sync_enabled", "true");
    localStorage.setItem(
      "cloud_token_dropbox",
      JSON.stringify({
        access_token: "sl.test-fake-token",
        expires_at: Date.now() + 3600000,
      })
    );
    localStorage.setItem("cloud_vault_password", "test-vault-pw-12345");
  });
}

async function collectToasts(page, durationMs = 4000) {
  return page.evaluate((ms) => {
    return new Promise((resolve) => {
      const texts = [];
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && node.classList.contains("cloud-toast")) {
              texts.push(node.textContent.trim());
            }
          }
        }
      });
      observer.observe(document.body, { childList: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(texts);
      }, ms);
    });
  }, durationMs);
}

test.describe("STAK-549 — Header cloud sync button silent failure", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("syncNow returns { synced: false } when no password is available", async ({ page }) => {
    await setupFullyConnected(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.syncNow === "function");

    // Remove password and stub getSyncPassword to return null (simulates user cancel)
    await page.evaluate(() => {
      localStorage.removeItem("cloud_vault_password");
      window.getSyncPassword = () => Promise.resolve(null);
      window.getSyncPasswordSilent = () => null;
    });

    const result = await page.evaluate(() => window.syncNow());

    expect(result).toEqual({ synced: false });
  });

  test("no false success toast when syncNow returns synced:false", async ({ page }) => {
    await setupFullyConnected(page);
    await page.goto("/index.html");
    await page.waitForSelector("#headerCloudSyncBtn", { state: "visible" });

    // Remove password and stub password functions to return null
    await page.evaluate(() => {
      localStorage.removeItem("cloud_vault_password");
      window.getSyncPassword = () => Promise.resolve(null);
      window.getSyncPasswordSilent = () => null;
      window.resolveHeaderCloudAction = () => ({ action: "sync-now", syncCapable: true });
    });

    const toastPromise = collectToasts(page);

    await page.locator("#headerCloudSyncBtn").click();

    const toasts = await toastPromise;

    const falseSuccess = toasts.filter(
      (t) => /synced|sync complete/i.test(t) && !/syncing/i.test(t)
    );
    expect(falseSuccess).toHaveLength(0);
  });

  test("syncNow proceeds to sync when password is cached (regression guard)", async ({ page }) => {
    await setupFullyConnected(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.syncNow === "function");

    // Stub push/pull to avoid real Dropbox calls
    await page.evaluate(() => {
      window.pollForRemoteChanges = async () => {};
      window.pushSyncVault = async () => {};
    });

    const result = await page.evaluate(() => window.syncNow());
    expect(result).toEqual({ synced: true });
  });
});

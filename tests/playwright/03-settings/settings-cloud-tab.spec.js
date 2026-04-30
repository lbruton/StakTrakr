import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "../helpers/seed.js";

async function closeSettingsModal(page) {
  await page.evaluate(() => {
    if (typeof window.hideSettingsModal === "function") {
      window.hideSettingsModal();
      return;
    }
    const modal = document.getElementById("settingsModal");
    if (modal) modal.style.display = "none";
    document.body.style.overflow = "";
  });
  await expect(page.locator("#settingsModal")).not.toBeVisible();
}

async function configureHeaderCloudState(
  page,
  { connected = false, hasPassword = false, hasAccountId = false, autoSyncEnabled = false } = {}
) {
  await page.evaluate(
    ({ connected, hasPassword, hasAccountId, autoSyncEnabled }) => {
      localStorage.removeItem("cloud_token_dropbox");
      localStorage.removeItem("cloud_vault_password");
      localStorage.removeItem("cloud_dropbox_account_id");
      localStorage.setItem("cloud_sync_enabled", autoSyncEnabled ? "true" : "false");

      if (connected) {
        localStorage.setItem(
          "cloud_token_dropbox",
          JSON.stringify({
            access_token: "test-token",
            expires_at: Date.now() + 60_000,
          })
        );
      }
      if (hasPassword) {
        localStorage.setItem("cloud_vault_password", "test-password");
      }
      if (hasAccountId) {
        localStorage.setItem("cloud_dropbox_account_id", "acct:test");
      }

      if (typeof window.updateCloudSyncHeaderBtn === "function") {
        window.updateCloudSyncHeaderBtn();
      }
    },
    { connected, hasPassword, hasAccountId, autoSyncEnabled }
  );
}

test.describe("STAK-444/STAK-544 — Settings → Cloud tab and header cloud button", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.showSettingsModal === "function");
    // Wait for init.js Phase 14's delayed listener setup (200 ms) to complete
    await page.waitForTimeout(300);
    await page.evaluate(() => window.showSettingsModal("system"));
    await expect(page.locator("#settingsModal")).toBeVisible();
    await expect(page.locator("#settingsPanel_system")).toBeVisible();
  });

  test("2.1 — Cloud tab shows settingsPanel_cloud and hides settingsPanel_system", async ({
    page,
  }) => {
    await page.locator('[data-section="cloud"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="cloud"]').click();
    await expect(page.locator("#settingsPanel_cloud")).toBeVisible();
    await expect(page.locator("#settingsPanel_system")).not.toBeVisible();
  });

  test("2.2 — Cloud panel contains #cloudCard_dropbox", async ({ page }) => {
    await page.locator('[data-section="cloud"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="cloud"]').click();
    const cloudPanel = page.locator("#settingsPanel_cloud");
    await expect(cloudPanel.locator("#cloudCard_dropbox")).toBeVisible();
  });

  test("2.3 — Cloud panel contains Cloud Sync Beta card", async ({ page }) => {
    await page.locator('[data-section="cloud"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="cloud"]').click();
    const cloudPanel = page.locator("#settingsPanel_cloud");
    await expect(cloudPanel.getByText("Cloud Sync Beta")).toBeVisible();
  });

  test("2.4 — System tab does not show #cloudCard_dropbox", async ({ page }) => {
    await page.locator('[data-section="system"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="system"]').click();
    const systemPanel = page.locator("#settingsPanel_system");
    await expect(systemPanel.locator("#cloudCard_dropbox")).toHaveCount(0);
  });

  test("2.5 — About tab Troubleshooting (forceRefreshBtn) visible", async ({ page }) => {
    await page.locator('[data-section="about"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="about"]').click();
    await expect(page.locator("#forceRefreshBtn")).toBeVisible();
  });

  test("2.5b — Inventory tab has no App Updates fieldset", async ({ page }) => {
    await page.locator('[data-section="system"]').scrollIntoViewIfNeeded();
    await page.locator('[data-section="system"]').click();
    const systemPanel = page.locator("#settingsPanel_system");
    await expect(
      systemPanel.locator(".settings-fieldset-title", { hasText: "App Updates" })
    ).toHaveCount(0);
  });

  test("2.6 — Header cloud button opens Cloud settings when sync is not configured", async ({
    page,
  }) => {
    await configureHeaderCloudState(page, {
      connected: false,
      hasPassword: false,
      hasAccountId: false,
      autoSyncEnabled: false,
    });
    await closeSettingsModal(page);

    await page.locator("#headerCloudSyncBtn").click();

    await expect(page.locator("#settingsModal")).toBeVisible();
    await expect(page.locator("#settingsPanel_cloud")).toBeVisible();
    await expect(page.locator("#settingsPanel_system")).not.toBeVisible();
  });

  test("2.7 — Header cloud button triggers manual sync when configured and auto-sync is off", async ({
    page,
  }) => {
    await configureHeaderCloudState(page, {
      connected: true,
      hasPassword: true,
      hasAccountId: true,
      autoSyncEnabled: false,
    });
    await closeSettingsModal(page);
    await page.evaluate(() => {
      window.__syncNowCalls = 0;
      window.syncNow = async () => {
        window.__syncNowCalls += 1;
      };
    });

    await page.locator("#headerCloudSyncBtn").click();

    await page.waitForFunction(() => window.__syncNowCalls === 1);
  });

  test("2.8 — Header cloud button triggers manual sync when configured and auto-sync is on", async ({
    page,
  }) => {
    await configureHeaderCloudState(page, {
      connected: true,
      hasPassword: true,
      hasAccountId: true,
      autoSyncEnabled: true,
    });
    await closeSettingsModal(page);
    await page.evaluate(() => {
      window.__syncNowCalls = 0;
      window.syncNow = async () => {
        window.__syncNowCalls += 1;
      };
    });

    await page.locator("#headerCloudSyncBtn").click();

    await page.waitForFunction(() => window.__syncNowCalls === 1);
  });
});

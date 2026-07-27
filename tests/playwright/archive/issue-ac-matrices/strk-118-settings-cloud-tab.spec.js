import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

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

      // The updateCloudSyncHeaderBtn() repaint that used to run here went with
      // the header button (STRK-287). Nothing needs repainting now — the seeded
      // state is read directly by the Cloud panel when it opens.
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

  // 2.6 / 2.7 / 2.8 REWRITTEN as one retirement record for STRK-287.
  //
  // All three drove #headerCloudSyncBtn and asserted its dual routing: open
  // Cloud settings when unconfigured (2.6), or run a manual sync when fully
  // configured, with auto-sync off (2.7) and on (2.8). The button is retired, so
  // the three cases collapse — there is no longer a state machine choosing
  // between destinations, just the two destinations themselves.
  //
  // They are folded into a single test rather than deleted so the matrix still
  // shows what happened to these criteria. Live coverage of the surviving
  // destinations belongs to core/header-retirement.spec.js.
  test("2.6/2.7/2.8 — header cloud button retired; both destinations live in Settings › Cloud", async ({
    page,
  }) => {
    // The configured state that used to select the "sync-now" branch — kept so
    // this asserts the button is absent even when it would previously have been
    // at its most active, not merely when it was gray.
    await configureHeaderCloudState(page, {
      connected: true,
      hasPassword: true,
      hasAccountId: true,
      autoSyncEnabled: true,
    });
    await closeSettingsModal(page);

    await expect(page.locator("#headerCloudSyncBtn")).toHaveCount(0);
    await expect(page.locator("#headerCloudSyncWrapper")).toHaveCount(0);
    await expect(page.locator("#headerCloudDot")).toHaveCount(0);

    // Destination A — the settings panel the unconfigured branch used to open.
    await page.evaluate(() => window.showSettingsModal("cloud"));
    await expect(page.locator("#settingsPanel_cloud")).toBeVisible();
    await expect(page.locator("#settingsPanel_system")).not.toBeVisible();

    // Destination B — the manual sync the configured branch used to trigger.
    await expect(page.locator("#cloudSyncNowBtn")).toBeAttached();
  });
});

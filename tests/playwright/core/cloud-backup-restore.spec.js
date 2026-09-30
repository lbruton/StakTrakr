// STRK-413 — restoring a Dropbox backup from Settings › Cloud › Restore.
//
// Pre-sync backups (`/StakTrakr/backups/pre-sync-*.stvault`) are written by
// pushSyncVault() under the composite sync key `vaultPassword:accountId`, but the
// restore click only tried the session's manual-backup password cache and then
// prompted. A typed vault password never equals the composite key, so every
// pre-sync restore failed with "Incorrect password or corrupted file." — the
// safety net was unusable exactly when it was needed (2026-09-30 Collections loss).
//
// These cases drive the real UI path (Restore button → backup row → confirm) with
// Dropbox mocked, and the backups encrypted by the app's own crypto chain.
import { test, expect } from "../helpers/mocks/extended-test.js";
import { encryptVaultPayload } from "../helpers/vault-fixtures.js";

const ACCOUNT_ID = "dbid:strk413-test-account";
const VAULT_PASSWORD = "strk413-vault-pass"; // gitleaks:allow — test fixture, not a real secret
const OLD_VAULT_PASSWORD = "strk413-old-vault-pass"; // gitleaks:allow — test fixture
const MANUAL_PASSWORD = "strk413-manual-pass"; // gitleaks:allow — test fixture
const PRE_SYNC_NAME = "pre-sync-2026-09-30T01-00-00-000Z.stvault";
const MANUAL_NAME = "staktrakr-backup-20260930-010000.stvault";

const LOCAL_ITEM = {
  uuid: "strk413-item",
  serial: 413,
  metal: "Silver",
  composition: "Silver",
  name: "STRK-413 Local",
  qty: 1,
  type: "Round",
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 31,
  date: "2026-09-01",
};

const BACKUP_PAYLOAD = {
  _meta: { appVersion: "3.36.35", exportTimestamp: "2026-09-30T01:00:00.000Z", scope: "full" },
  data: { metalInventory: JSON.stringify([{ ...LOCAL_ITEM, name: "STRK-413 From Backup" }]) },
};

/** Seed a connected Dropbox device; `vaultPassword` null models a device that never stored it. */
async function seedConnectedDevice(page, vaultPassword) {
  await page.addInitScript(
    ({ accountId, password, item }) => {
      localStorage.setItem("metalInventory", JSON.stringify([item]));
      localStorage.setItem("cloud_dropbox_account_id", accountId);
      localStorage.setItem("cloud_sync_migrated", "v2");
      if (password) localStorage.setItem("cloud_vault_password", password);
      localStorage.setItem(
        "cloud_token_dropbox",
        JSON.stringify({ access_token: "sl.strk413-test-token", expires_at: Date.now() + 3600000 })
      );
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
        },
        { once: true }
      );
    },
    { accountId: ACCOUNT_ID, password: vaultPassword, item: LOCAL_ITEM }
  );
}

/** Serve one backup file from a mocked `/StakTrakr/backups/` folder. */
async function routeBackupFolder(page, name, bytes) {
  await page.route("https://api.dropboxapi.com/2/files/list_folder", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        entries: [
          {
            ".tag": "file",
            name,
            size: bytes.length,
            server_modified: "2026-09-30T01:00:00Z",
          },
        ],
        has_more: false,
      }),
    });
  });
  await page.route("https://content.dropboxapi.com/2/files/download", async (route) => {
    const arg = JSON.parse(route.request().headers()["dropbox-api-arg"] || "{}");
    if (arg.path === `/StakTrakr/backups/${name}`) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(bytes),
      });
      return;
    }
    await route.fulfill({ status: 409, body: "{}" });
  });
}

async function bootApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      window.appListenersReady === true &&
      typeof window.vaultDeriveKey === "function" &&
      typeof window.DiffModal !== "undefined"
  );
}

/** Settings › Cloud › Restore → click the listed backup → confirm the overwrite prompt. */
async function restoreListedBackup(page, name) {
  await page.evaluate(() => window.showSettingsModal("system"));
  await page.locator('[data-section="cloud"]').click();
  const restoreBtn = page.locator(
    '#settingsPanel_cloud .cloud-restore-btn[data-provider="dropbox"]'
  );
  await expect(restoreBtn).toBeEnabled();
  await restoreBtn.click();
  await page.locator(`.cloud-backup-entry[data-filename="${name}"]`).click();
  await expect(page.locator("#appDialogModal")).toBeVisible();
  await page.locator("#appDialogOk").click();
}

async function submitVaultPassword(page, password) {
  await expect(page.locator("#vaultModal")).toBeVisible();
  await page.locator("#vaultPassword").fill(password);
  await page.locator("#vaultActionBtn").click();
}

test.describe("core/cloud-backup-restore (STRK-413)", () => {
  test("a pre-sync backup restores with the device's sync key, without a password prompt", async ({
    page,
  }) => {
    await seedConnectedDevice(page, VAULT_PASSWORD);
    await bootApp(page);
    const bytes = await encryptVaultPayload(
      page,
      BACKUP_PAYLOAD,
      `${VAULT_PASSWORD}:${ACCOUNT_ID}`
    );
    await routeBackupFolder(page, PRE_SYNC_NAME, bytes);

    await restoreListedBackup(page, PRE_SYNC_NAME);

    await expect(page.locator("#diffReviewModal")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#diffReviewModal")).toContainText("STRK-413 From Backup");
    await expect(page.locator("#vaultModal")).toBeHidden();
  });

  test("the vault password typed at the prompt unlocks a pre-sync backup", async ({ page }) => {
    // A device that has not stored the vault password (fresh browser, cleared storage)
    // cannot derive the key silently, so the prompt must accept the vault password.
    await seedConnectedDevice(page, null);
    await bootApp(page);
    const bytes = await encryptVaultPayload(
      page,
      BACKUP_PAYLOAD,
      `${VAULT_PASSWORD}:${ACCOUNT_ID}`
    );
    await routeBackupFolder(page, PRE_SYNC_NAME, bytes);

    await restoreListedBackup(page, PRE_SYNC_NAME);
    await submitVaultPassword(page, VAULT_PASSWORD);

    await expect(page.locator("#diffReviewModal")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#diffReviewModal")).toContainText("STRK-413 From Backup");
  });

  test("a manual backup still restores with the password chosen when it was made", async ({
    page,
  }) => {
    await seedConnectedDevice(page, VAULT_PASSWORD);
    await bootApp(page);
    const bytes = await encryptVaultPayload(page, BACKUP_PAYLOAD, MANUAL_PASSWORD);
    await routeBackupFolder(page, MANUAL_NAME, bytes);

    await restoreListedBackup(page, MANUAL_NAME);
    await submitVaultPassword(page, MANUAL_PASSWORD);

    await expect(page.locator("#diffReviewModal")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#diffReviewModal")).toContainText("STRK-413 From Backup");
  });

  test("a password that fits no key says which password each backup type uses", async ({
    page,
  }) => {
    // Written before a vault-password change: neither the stored key nor the typed
    // current password opens it. The message must not read as file corruption.
    await seedConnectedDevice(page, VAULT_PASSWORD);
    await bootApp(page);
    const bytes = await encryptVaultPayload(
      page,
      BACKUP_PAYLOAD,
      `${OLD_VAULT_PASSWORD}:${ACCOUNT_ID}`
    );
    await routeBackupFolder(page, PRE_SYNC_NAME, bytes);

    await restoreListedBackup(page, PRE_SYNC_NAME);
    await submitVaultPassword(page, VAULT_PASSWORD);

    const status = page.locator("#vaultStatus");
    await expect(status).toContainText("Sync backups", { timeout: 15000 });
    await expect(status).toContainText("Manual backups");
    await expect(status).not.toContainText("corrupted");
    await expect(page.locator("#diffReviewModal")).toBeHidden();
  });
});

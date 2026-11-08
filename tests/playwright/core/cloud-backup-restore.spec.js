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
const VAULT_PHRASE = "strk413-vault-pass"; // gitleaks:allow — test fixture, not a real secret
const OLD_VAULT_PHRASE = "strk413-old-vault-pass"; // gitleaks:allow — test fixture
const MANUAL_PHRASE = "strk413-manual-pass"; // gitleaks:allow — test fixture
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
  const okBtn = page.locator("#appDialogOk");
  await expect(okBtn).toHaveText("Overwrite local data");
  await expect(okBtn).toHaveClass(/(^|\s)danger(\s|$)/);
  await expect(page.locator("#appDialogCancel")).toBeFocused();
  await okBtn.click();
}

/**
 * Wrap window.vaultDeriveKey with a counter exposed as window.__deriveCount.
 * @param {import('@playwright/test').Page} page - Booted app page
 */
async function countKeyDerivations(page) {
  await page.evaluate(() => {
    const original = window.vaultDeriveKey;
    window.__deriveCount = 0;
    window.vaultDeriveKey = async (...args) => {
      window.__deriveCount++;
      return original(...args);
    };
  });
}

/**
 * Serve an unreadable sync vault and count vault downloads and uploads.
 * Set `holdNext` to make the next vault download wait until `release()` runs.
 * @param {import('@playwright/test').Page} page - Page to route
 * @returns {Promise<object>} Live counters and the hold controls
 */
async function routeUnreadableSyncVault(page) {
  const state = { downloads: 0, uploads: 0, holdPath: null, held: null, release: () => {} };
  /** Hold the next download of `path` until `release()` runs. */
  state.hold = (path) => {
    state.holdPath = path;
    state.held = null;
  };
  await page.route("https://content.dropboxapi.com/2/files/download", async (route) => {
    const arg = JSON.parse(route.request().headers()["dropbox-api-arg"] || "{}");
    if (arg.path === state.holdPath) {
      state.holdPath = null;
      state.held = new Promise((resolve) => {
        state.release = resolve;
      });
      await state.held;
    }
    if (arg.path !== SYNC_VAULT_PATH) {
      await route.fulfill({ status: 409, body: "{}" });
      return;
    }
    state.downloads++;
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: Buffer.from("not a vault file, so decryption fails"),
    });
  });
  await page.route("https://content.dropboxapi.com/2/files/upload", async (route) => {
    state.uploads++;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  return state;
}

const SYNC_VAULT_PATH = "/StakTrakr/sync/staktrakr-sync.stvault";
const SYNC_META_PATH = "/StakTrakr/sync/staktrakr-sync.json";

/** Open the Restore Preview failure modal through a real pull of the unreadable vault. */
async function openFailedPreview(page) {
  await page.evaluate(() =>
    window.pullWithPreview({ syncId: "preview-fail", deviceId: "other-device", timestamp: 1 })
  );
  await expect(page.locator("#restorePreviewModal")).toBeVisible();
}

async function submitVaultPassword(page, password) {
  await expect(page.locator("#vaultModal")).toBeVisible();
  await page.locator("#vaultPassword").fill(password);
  await page.locator("#vaultActionBtn").click();
}

test.describe("core/cloud-backup-restore", () => {
  test("a pre-sync backup restores with the device's sync key, without a password prompt", async ({
    page,
  }) => {
    await seedConnectedDevice(page, VAULT_PHRASE);
    await bootApp(page);
    const bytes = await encryptVaultPayload(page, BACKUP_PAYLOAD, `${VAULT_PHRASE}:${ACCOUNT_ID}`);
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
    const bytes = await encryptVaultPayload(page, BACKUP_PAYLOAD, `${VAULT_PHRASE}:${ACCOUNT_ID}`);
    await routeBackupFolder(page, PRE_SYNC_NAME, bytes);

    await restoreListedBackup(page, PRE_SYNC_NAME);
    await submitVaultPassword(page, VAULT_PHRASE);

    await expect(page.locator("#diffReviewModal")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#diffReviewModal")).toContainText("STRK-413 From Backup");
  });

  test("a manual backup still restores with the password chosen when it was made", async ({
    page,
  }) => {
    await seedConnectedDevice(page, VAULT_PHRASE);
    await bootApp(page);
    const bytes = await encryptVaultPayload(page, BACKUP_PAYLOAD, MANUAL_PHRASE);
    await routeBackupFolder(page, MANUAL_NAME, bytes);

    await restoreListedBackup(page, MANUAL_NAME);
    await submitVaultPassword(page, MANUAL_PHRASE);

    await expect(page.locator("#diffReviewModal")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#diffReviewModal")).toContainText("STRK-413 From Backup");
  });

  test("a password that fits no key says which password each backup type uses", async ({
    page,
  }) => {
    // Written before a vault-password change: neither the stored key nor the typed
    // current password opens it. The message must not read as file corruption.
    await seedConnectedDevice(page, VAULT_PHRASE);
    await bootApp(page);
    const bytes = await encryptVaultPayload(
      page,
      BACKUP_PAYLOAD,
      `${OLD_VAULT_PHRASE}:${ACCOUNT_ID}`
    );
    await routeBackupFolder(page, PRE_SYNC_NAME, bytes);

    await restoreListedBackup(page, PRE_SYNC_NAME);
    await submitVaultPassword(page, VAULT_PHRASE);

    const status = page.locator("#vaultStatus");
    await expect(status).toContainText("Sync backups", { timeout: 15000 });
    await expect(status).toContainText("Manual backups");
    await expect(status).not.toContainText("corrupted");
    await expect(page.locator("#diffReviewModal")).toBeHidden();
  });

  test("vaultFindBackupKey refuses a file over the vault size limit before any key work", async ({
    page,
  }) => {
    await seedConnectedDevice(page, VAULT_PHRASE);
    await bootApp(page);
    const result = await page.evaluate(async () => {
      const original = window.vaultDeriveKey;
      window.__deriveCount = 0;
      window.vaultDeriveKey = async (...args) => {
        window.__deriveCount++;
        return original(...args);
      };
      const oversized = new Uint8Array(VAULT_MAX_FILE_SIZE + 1);
      let message = null;
      try {
        await window.vaultFindBackupKey(oversized, ["any-key-1234"]);
      } catch (err) {
        message = err.message;
      }
      return { message, derivations: window.__deriveCount };
    });

    expect(result.message).toContain("50MB");
    expect(result.derivations).toBe(0);
  });

  test("a silent pre-sync restore derives the key only once", async ({ page }) => {
    await seedConnectedDevice(page, VAULT_PHRASE);
    await bootApp(page);
    const bytes = await encryptVaultPayload(page, BACKUP_PAYLOAD, `${VAULT_PHRASE}:${ACCOUNT_ID}`);
    await routeBackupFolder(page, PRE_SYNC_NAME, bytes);
    // Installed after encryption so only the restore's derivations are counted.
    await countKeyDerivations(page);

    await restoreListedBackup(page, PRE_SYNC_NAME);

    await expect(page.locator("#diffReviewModal")).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => window.__deriveCount)).toBe(1);
  });

  test("a manual backup goes straight to the prompt without probing sync keys", async ({
    page,
  }) => {
    await seedConnectedDevice(page, VAULT_PHRASE);
    await bootApp(page);
    const bytes = await encryptVaultPayload(page, BACKUP_PAYLOAD, MANUAL_PHRASE);
    await routeBackupFolder(page, MANUAL_NAME, bytes);
    await countKeyDerivations(page);

    await restoreListedBackup(page, MANUAL_NAME);

    await expect(page.locator("#vaultModal")).toBeVisible();
    expect(await page.evaluate(() => window.__deriveCount)).toBe(0);
  });
  test("a preview that cannot read the sync vault offers Try again before Restore without preview", async ({
    page,
  }) => {
    await seedConnectedDevice(page, VAULT_PHRASE);
    await bootApp(page);
    const vault = await routeUnreadableSyncVault(page);

    await openFailedPreview(page);
    await expect(page.locator("#cloudAutoSyncStatus .cloud-sync-status-text")).toHaveText(
      "Could not read backup"
    );
    const modal = page.locator("#restorePreviewModal");
    await expect(modal).toBeVisible();
    await expect(page.locator("#restorePreviewError")).toHaveText(
      "Could not read this backup. Check the vault password and try again."
    );
    await expect(modal).not.toContainText(/decrypt|Error:|operation/i);
    const actions = modal.locator(".encryption-actions button:visible");
    await expect(actions).toHaveText(["Try again", "Restore without preview", "Cancel"]);
    await expect(actions.first()).toHaveClass(/\bsuccess\b/);
    await expect(actions.nth(1)).toHaveClass(/\bsecondary\b/);
    await expect(actions.nth(2)).toHaveClass(/\bsecondary\b/);
    await expect(page.locator("#restorePreviewFallbackNote")).toContainText(
      "saves a snapshot of this device first"
    );

    await page.evaluate(() => {
      window.__retryCalls = [];
      window.__fallbackCalls = [];
      window.__passwordPrompts = [];
      window.getSyncPassword = (forcePrompt) => {
        window.__passwordPrompts.push(forcePrompt === true);
        return Promise.resolve("corrected-password:account");
      };
      window.__realPullWithPreview = window.pullWithPreview;
      window.pullWithPreview = (meta) => window.__retryCalls.push(meta.syncId);
      window.pullSyncVault = (meta) => {
        window.__fallbackCalls.push(meta.syncId);
        return Promise.resolve();
      };
    });
    await actions.first().click();
    await expect(modal).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__retryCalls)).toEqual(["preview-fail"]);
    expect(await page.evaluate(() => window.__passwordPrompts)).toEqual([true]);
    expect(await page.evaluate(() => window.__fallbackCalls)).toEqual([]);

    await page.evaluate(() => {
      window.pullWithPreview = window.__realPullWithPreview;
    });
    await openFailedPreview(page);
    await page.locator("#restorePreviewFallbackBtn").click();
    await expect(modal).toBeHidden();
    expect(await page.evaluate(() => window.__fallbackCalls)).toEqual(["preview-fail"]);

    await openFailedPreview(page);
    vault.hold(SYNC_VAULT_PATH);
    await page.evaluate(() => {
      window.__secondPull = window.pullWithPreview({
        syncId: "preview-fail",
        deviceId: "other-device",
        timestamp: 1,
      });
    });
    await expect.poll(() => vault.held !== null).toBe(true);
    await page.locator("#restorePreviewApplyBtn").click();
    await expect(modal).toBeVisible();
    await expect(page.locator("#restorePreviewError")).toHaveText(
      "A sync check is still running. Try again when it finishes."
    );
    vault.release();
    await page.evaluate(() => window.__secondPull);
    await expect(page.locator("#restorePreviewError")).toHaveText(
      "Could not read this backup. Check the vault password and try again."
    );
    await page.locator("#restorePreviewCancelBtn").click();
    await expect(modal).toBeHidden();
    expect(await page.evaluate(() => window.__fallbackCalls)).toEqual(["preview-fail"]);
  });

  test("Try again holds pushes until the retry download finishes, then runs the held push", async ({
    page,
  }) => {
    await seedConnectedDevice(page, VAULT_PHRASE);
    await bootApp(page);
    const vault = await routeUnreadableSyncVault(page);
    await openFailedPreview(page);
    await page.evaluate(() => localStorage.setItem("cloud_sync_enabled", "true"));

    // A push that is already running keeps the modal open.
    vault.hold(SYNC_META_PATH);
    await page.evaluate(() => {
      window.__runningPush = window.pushSyncVault();
    });
    await expect.poll(() => vault.held !== null).toBe(true);
    await page.locator("#restorePreviewApplyBtn").click();
    await expect(page.locator("#restorePreviewError")).toHaveText(
      "A sync check is still running. Try again when it finishes."
    );
    vault.release();
    await page.evaluate(() => window.__runningPush);
    const uploadsBeforeRetry = vault.uploads;

    // Queue the push and click in one step so the debounce cannot fire first.
    await page.evaluate(() => {
      window.scheduleSyncPush();
      window.__pushQueuedAt = Date.now();
      document.getElementById("restorePreviewApplyBtn").click();
    });
    await expect(page.locator("#cloudSyncPasswordModal")).toBeVisible();
    await page.evaluate(() => window.pushSyncVault());
    expect(vault.uploads).toBe(uploadsBeforeRetry);

    vault.hold(SYNC_VAULT_PATH);
    await page.locator("#syncPasswordInput").fill(VAULT_PHRASE);
    await page.locator("#syncPasswordConfirmBtn").click();
    await expect.poll(() => vault.held !== null).toBe(true);
    await page.evaluate(() => window.pushSyncVault());
    await page.waitForFunction(
      () => Date.now() - window.__pushQueuedAt > window.SYNC_PUSH_DEBOUNCE + 500
    );
    expect(vault.uploads).toBe(uploadsBeforeRetry);

    const downloadsBeforeRelease = vault.downloads;
    vault.release();
    await expect.poll(() => vault.downloads).toBe(downloadsBeforeRelease + 1);
    await expect(page.locator("#restorePreviewModal")).toBeVisible();
    expect(vault.uploads).toBe(uploadsBeforeRetry);
    await expect.poll(() => vault.uploads, { timeout: 10000 }).toBeGreaterThan(uploadsBeforeRetry);
  });
});

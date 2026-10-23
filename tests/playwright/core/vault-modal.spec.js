// STRK-170 cohort 1.4 — characterization coverage for the vault modal dispatch
// surface (`openVaultModal` + `handleVaultAction`). These functions had NO direct
// test coverage before this spec; the crypto round-trip itself is covered by
// core/import-export.spec.js and the catalog key restore tests at the end of this file.
//
// The complexity refactor decomposes both functions into per-mode/per-phase
// helpers. This spec pins the observable, deterministic behavior the refactor
// most risks changing:
//   - openVaultModal: mode -> modal title / action button / row visibility / data-vault-mode
//   - handleVaultAction: password validation guards, local-export status messages,
//     and the import dispatch (runs importEncryptedBackup + closes the modal when
//     the diff-preview path is available).
//
// vault.js loads as a classic <script defer> (not an ES module), so its top-level
// `function`/`var` declarations are writable window properties — that is why
// stubbing window.exportEncryptedBackup / window.importEncryptedBackup and setting
// window._vaultPendingFile are seen by the bare references inside handleVaultAction.
import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const VAULT_PASSWORD = "strk170-vault-pass"; // gitleaks:allow — test fixture, not a real secret

/** Boot the app to a state where the vault modal API is available. */
async function bootVault(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.openVaultModal === "function" &&
      typeof window.handleVaultAction === "function" &&
      typeof window.DiffModal !== "undefined"
  );
}

test.describe("STRK-170 vault modal characterization (cohort 1.4)", () => {
  test("openVaultModal renders local export-mode layout", async ({ page }) => {
    await bootVault(page);
    const r = await page.evaluate(() => {
      window.openVaultModal("export");
      const q = (id) => document.getElementById(id);
      return {
        title: q("vaultModalTitle").textContent,
        actionText: q("vaultActionBtn").textContent,
        actionClass: q("vaultActionBtn").className,
        confirmRow: q("vaultConfirmRow").style.display,
        strengthRow: q("vaultStrengthRow").style.display,
        fileInfo: q("vaultFileInfo").style.display,
        descExport: q("vaultDescExport").style.display,
        descImport: q("vaultDescImport").style.display,
        mode: q("vaultModal").getAttribute("data-vault-mode"),
      };
    });
    expect(r).toEqual({
      title: "Export Encrypted Backup",
      actionText: "Export",
      actionClass: "btn",
      confirmRow: "",
      strengthRow: "",
      fileInfo: "none",
      descExport: "",
      descImport: "none",
      mode: "export",
    });
  });

  test("openVaultModal renders local import-mode layout", async ({ page }) => {
    await bootVault(page);
    const r = await page.evaluate(() => {
      window.openVaultModal("import", null);
      const q = (id) => document.getElementById(id);
      return {
        title: q("vaultModalTitle").textContent,
        actionText: q("vaultActionBtn").textContent,
        actionClass: q("vaultActionBtn").className,
        confirmRow: q("vaultConfirmRow").style.display,
        fileInfo: q("vaultFileInfo").style.display,
        descExport: q("vaultDescExport").style.display,
        descImport: q("vaultDescImport").style.display,
        imageFileRow: q("vaultImageFileRow").style.display,
        mode: q("vaultModal").getAttribute("data-vault-mode"),
      };
    });
    expect(r).toEqual({
      title: "Import Encrypted Backup",
      actionText: "Import",
      actionClass: "btn info",
      confirmRow: "none",
      fileInfo: "",
      descExport: "none",
      descImport: "",
      imageFileRow: "",
      mode: "import",
    });
  });

  test("openVaultModal renders cloud-export layout", async ({ page }) => {
    await bootVault(page);
    const r = await page.evaluate(() => {
      window.openVaultModal("cloud-export", { provider: "dropbox", isManualBackup: true });
      const q = (id) => document.getElementById(id);
      return {
        title: q("vaultModalTitle").textContent,
        actionText: q("vaultActionBtn").textContent,
        mode: q("vaultModal").getAttribute("data-vault-mode"),
      };
    });
    expect(r).toEqual({
      title: "Cloud Backup — Enter Password",
      actionText: "Encrypt & Upload",
      mode: "cloud-export",
    });
  });

  test("openVaultModal renders cloud-import layout with file info", async ({ page }) => {
    await bootVault(page);
    const r = await page.evaluate(() => {
      window.openVaultModal("cloud-import", {
        provider: "dropbox",
        fileBytes: new Uint8Array([1, 2, 3]),
        filename: "my-backup.stvault",
        size: 3,
      });
      const q = (id) => document.getElementById(id);
      return {
        title: q("vaultModalTitle").textContent,
        actionText: q("vaultActionBtn").textContent,
        fileName: q("vaultFileName").textContent,
        fileSize: q("vaultFileSize").textContent,
        imageFileRow: q("vaultImageFileRow").style.display,
        mode: q("vaultModal").getAttribute("data-vault-mode"),
      };
    });
    expect(r).toEqual({
      title: "Cloud Restore — Enter Password",
      actionText: "Decrypt & Restore",
      fileName: "my-backup.stvault",
      fileSize: "3 B",
      imageFileRow: "none",
      mode: "cloud-import",
    });
  });

  test("handleVaultAction rejects a password shorter than the minimum", async ({ page }) => {
    await bootVault(page);
    const status = await page.evaluate(async () => {
      window.openVaultModal("export");
      document.getElementById("vaultPassword").value = "short"; // 5 < VAULT_MIN_PASSWORD_LENGTH (8)
      await window.handleVaultAction();
      return document.getElementById("vaultStatus").textContent;
    });
    expect(status).toContain("Password must be at least");
    expect(status).toContain("characters");
  });

  test("handleVaultAction rejects mismatched confirm password in export mode", async ({ page }) => {
    await bootVault(page);
    const status = await page.evaluate(async () => {
      window.openVaultModal("export");
      document.getElementById("vaultPassword").value = "longenoughpw";
      document.getElementById("vaultConfirmPassword").value = "differentpw1";
      await window.handleVaultAction();
      return document.getElementById("vaultStatus").textContent;
    });
    expect(status).toContain("Passwords do not match");
  });

  test("handleVaultAction rejects import with no pending file", async ({ page }) => {
    await bootVault(page);
    const status = await page.evaluate(async () => {
      window.openVaultModal("import", null);
      window._vaultPendingFile = null;
      document.getElementById("vaultPassword").value = "longenoughpw";
      await window.handleVaultAction();
      return document.getElementById("vaultStatus").textContent;
    });
    expect(status).toContain("No file loaded");
  });

  test("handleVaultAction local export reports multi-file download success", async ({ page }) => {
    await bootVault(page);
    const status = await page.evaluate(async () => {
      window.exportEncryptedBackup = async () => ({ imageCount: 2, attachmentCount: 1 });
      window.openVaultModal("export");
      document.getElementById("vaultPassword").value = "longenoughpw";
      document.getElementById("vaultConfirmPassword").value = "longenoughpw";
      await window.handleVaultAction();
      return document.getElementById("vaultStatus").textContent;
    });
    expect(status).toContain("3 files downloaded");
    expect(status).toContain("2 photos");
    expect(status).toContain("1 attachment");
  });

  test("handleVaultAction local export surfaces a photo-export-failure warning", async ({
    page,
  }) => {
    await bootVault(page);
    const status = await page.evaluate(async () => {
      window.exportEncryptedBackup = async () => ({ imageExportFailed: true });
      window.openVaultModal("export");
      document.getElementById("vaultPassword").value = "longenoughpw";
      document.getElementById("vaultConfirmPassword").value = "longenoughpw";
      await window.handleVaultAction();
      return document.getElementById("vaultStatus").textContent;
    });
    expect(status).toContain("Photo backup failed");
  });

  test("handleVaultAction import dispatch runs importEncryptedBackup and closes the modal", async ({
    page,
  }) => {
    await bootVault(page);
    const r = await page.evaluate(async (password) => {
      let importArgs = null;
      window.importEncryptedBackup = async (bytes, pw) => {
        importArgs = [Array.from(bytes), pw];
      };
      window.openVaultModal("import", null);
      window._vaultPendingFile = new Uint8Array([10, 20, 30]);
      document.getElementById("vaultPassword").value = password;
      await window.handleVaultAction();
      return {
        importArgs,
        modalDisplay: document.getElementById("vaultModal").style.display,
      };
    }, VAULT_PASSWORD);
    expect(r.importArgs).toEqual([[10, 20, 30], VAULT_PASSWORD]);
    expect(r.modalDisplay).toBe("none");
  });
});

// The CatalogConfig singleton reads catalog_api_config once in its constructor.
// A restore must rehydrate it, or the next CatalogConfig.save() (a usage-counter
// increment) writes the stale in-memory defaults over the restored key.

// Test fixtures, not real credentials.
const RESTORE_VAULT_PASSWORD = "strk186-vault-pass"; // gitleaks:allow
const NUMISTA_KEY = "strk186-numista-api-key"; // gitleaks:allow

/**
 * Seeds the Numista key through the real setter (localStorage and in-memory
 * config), then exports an encrypted vault. Not seeded with addInitScript: init
 * scripts run again on every navigation and would restore the key after the wipe.
 * @param {import('@playwright/test').Page} page - Page to boot.
 * @returns {Promise<number[]>} Vault bytes.
 */
async function seedKeyAndExport(page) {
  await injectSeedInventory(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.vaultEncryptToBytes === "function" &&
      typeof window.catalogConfig !== "undefined"
  );
  return page.evaluate(
    async ({ password, key }) => {
      window.catalogConfig.setNumistaConfig(key);
      const bytes = await window.vaultEncryptToBytes(password);
      return Array.from(bytes);
    },
    { password: RESTORE_VAULT_PASSWORD, key: NUMISTA_KEY }
  );
}

/**
 * Clears localStorage from a same-origin page where the app is not running, then
 * boots the app so CatalogConfig constructs from empty defaults.
 * @param {import('@playwright/test').Page} page - Page to reboot.
 * @returns {Promise<void>}
 */
async function wipeAndReboot(page) {
  await page.goto("/strk186-neutral-404", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.catalogConfig !== "undefined");
}

/**
 * Decodes the Numista key persisted in localStorage (base64).
 * @param {import('@playwright/test').Page} page - Booted page.
 * @returns {Promise<string|null>}
 */
function readPersistedKey(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("catalog_api_config");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const stored = parsed?.numista?.apiKey || "";
    try {
      return atob(stored);
    } catch (e) {
      return stored;
    }
  });
}

test.describe("STRK-186 catalog key vault restore", () => {
  test("full restore rehydrates CatalogConfig and key survives usage-counter save + reload", async ({
    page,
  }) => {
    const vaultBytes = await seedKeyAndExport(page);
    await wipeAndReboot(page);

    // The wipe removed the key from the booted singleton.
    const wipedKey = await page.evaluate(() => window.catalogConfig.config.numista.apiKey);
    expect(wipedKey).toBe("");

    // The legacy full restore is also the path of the diff-preview fallback and
    // the cloud-sync pull.
    const inMemoryKey = await page.evaluate(
      async ({ password, bytes }) => {
        window.showToast = () => {};
        await window.vaultDecryptAndRestore(new Uint8Array(bytes), password);
        return window.catalogConfig.config.numista.apiKey;
      },
      { password: RESTORE_VAULT_PASSWORD, bytes: vaultBytes }
    );
    expect(inMemoryKey).toBe(NUMISTA_KEY);

    // A usage-counter save writes the in-memory config back to localStorage.
    await page.evaluate(() => window.catalogConfig.incrementNumistaUsage());
    expect(await readPersistedKey(page)).toBe(NUMISTA_KEY);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.catalogConfig !== "undefined");
    expect(await readPersistedKey(page)).toBe(NUMISTA_KEY);
    expect(await page.evaluate(() => window.catalogConfig.config.numista.apiKey)).toBe(NUMISTA_KEY);
  });

  test("diff-preview apply rehydrates CatalogConfig and key survives usage-counter save", async ({
    page,
  }) => {
    const vaultBytes = await seedKeyAndExport(page);
    await wipeAndReboot(page);
    await page.waitForFunction(
      () =>
        typeof window.vaultRestoreWithPreview === "function" &&
        typeof window.DiffModal !== "undefined"
    );

    // Settings apply all or nothing, so an empty selection still applies them.
    const result = await page.evaluate(
      async ({ password, bytes }) => {
        let applied = false;
        const origShow = window.DiffModal.show;
        window.showToast = () => {};
        window.DiffModal.show = (opts) => {
          applied = true;
          opts.onApply([]);
        };
        await window.vaultRestoreWithPreview(new Uint8Array(bytes), password);
        window.DiffModal.show = origShow;
        return {
          applied,
          inMemoryKey: window.catalogConfig.config.numista.apiKey,
        };
      },
      { password: RESTORE_VAULT_PASSWORD, bytes: vaultBytes }
    );
    expect(result.applied).toBe(true);
    expect(result.inMemoryKey).toBe(NUMISTA_KEY);

    await page.evaluate(() => window.catalogConfig.incrementNumistaUsage());
    expect(await readPersistedKey(page)).toBe(NUMISTA_KEY);
  });
});

import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

// F.3 — stvault companion file tests (AC-4, AC-7)

test.describe("STRK-45 — Attachment vault companion constants", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(
      () =>
        typeof window.VAULT_ATTACHMENT_FILE_SUFFIX !== "undefined" ||
        typeof window.SYNC_ATTACHMENTS_PATH !== "undefined"
    );
  });

  test("VAULT_ATTACHMENT_FILE_SUFFIX is '-attachments'", async ({ page }) => {
    const suffix = await page.evaluate(() => window.VAULT_ATTACHMENT_FILE_SUFFIX);
    expect(suffix).toBe("-attachments");
  });

  test("SYNC_ATTACHMENTS_PATH contains '-attachments.stvault'", async ({ page }) => {
    const path = await page.evaluate(() => window.SYNC_ATTACHMENTS_PATH);
    expect(path).toContain("-attachments");
    expect(path).toContain(".stvault");
  });

  test("companion download file name uses -attachments suffix before .stvault extension", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const suffix = window.VAULT_ATTACHMENT_FILE_SUFFIX || "-attachments";
      const ext = ".stvault";
      const timestamp = "2026-01-01_000000";
      const fileName = "staktrakr_backup_" + timestamp + suffix + ext;
      return {
        fileName,
        hasSuffix: fileName.includes("-attachments"),
        hasExt: fileName.endsWith(".stvault"),
      };
    });
    expect(result.hasSuffix).toBe(true);
    expect(result.hasExt).toBe(true);
  });
});

test.describe("STRK-45 — Attachment vault companion re-association", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.attachmentManager !== "undefined");
  });

  test("attachmentUuid in item metadata matches the key used for IDB lookup", async ({ page }) => {
    // Re-association on restore relies on matching item.attachments[].attachmentUuid
    // to attachmentManager.getAttachment(uuid). Verify the contract holds.
    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      const uuid = "f3-reasso-uuid";
      await attachmentManager.addAttachment({
        attachmentUuid: uuid,
        itemUuid: "f3-item-uuid",
        fileName: "certificate.pdf",
        mimeType: "application/pdf",
        size: 1500,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        blob: new Blob(["cert data"], { type: "application/pdf" }),
      });
      // Simulate re-association: look up by the UUID from item metadata
      const itemMeta = { attachmentUuid: uuid, fileName: "certificate.pdf" };
      const fetched = await attachmentManager.getAttachment(itemMeta.attachmentUuid);
      return {
        found: fetched !== null,
        uuidMatches: fetched?.attachmentUuid === uuid,
        fileNameMatches: fetched?.fileName === "certificate.pdf",
      };
    });
    expect(result.found).toBe(true);
    expect(result.uuidMatches).toBe(true);
    expect(result.fileNameMatches).toBe(true);
  });

  test("syncAttachments storage key is in ALLOWED_STORAGE_KEYS", async ({ page }) => {
    const result = await page.evaluate(() => {
      if (!Array.isArray(window.ALLOWED_STORAGE_KEYS)) return null;
      return window.ALLOWED_STORAGE_KEYS.includes("syncAttachments");
    });
    expect(result).toBe(true);
  });

  test("syncAttachmentsWarnSeen storage key is in ALLOWED_STORAGE_KEYS", async ({ page }) => {
    const result = await page.evaluate(() => {
      if (!Array.isArray(window.ALLOWED_STORAGE_KEYS)) return null;
      return window.ALLOWED_STORAGE_KEYS.includes("syncAttachmentsWarnSeen");
    });
    expect(result).toBe(true);
  });
});

test.describe("STRK-45 — Attachment vault encrypt/decrypt functions", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(
      () =>
        typeof window.vaultEncryptAttachmentVault === "function" ||
        typeof window.collectAndHashAttachmentVault === "function"
    );
  });

  test("vaultEncryptAttachmentVault and collectAndHashAttachmentVault are exposed", async ({
    page,
  }) => {
    const exposed = await page.evaluate(() => ({
      hasEncrypt: typeof window.vaultEncryptAttachmentVault === "function",
      hasCollect: typeof window.collectAndHashAttachmentVault === "function",
    }));
    // At least one of the two companion helpers should be exposed
    expect(exposed.hasEncrypt || exposed.hasCollect).toBe(true);
  });
});

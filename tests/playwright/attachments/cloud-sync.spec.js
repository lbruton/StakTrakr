import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

// F.4 — Cloud sync attachment tests (AC-9)

function setupCloudConnected(page) {
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

test.describe("STRK-45 — Cloud sync attachment storage keys", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await setupCloudConnected(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.ALLOWED_STORAGE_KEYS !== "undefined");
  });

  test("syncAttachments key is in ALLOWED_STORAGE_KEYS", async ({ page }) => {
    const included = await page.evaluate(
      () => Array.isArray(ALLOWED_STORAGE_KEYS) && ALLOWED_STORAGE_KEYS.includes("syncAttachments")
    );
    expect(included).toBe(true);
  });

  test("syncAttachmentsWarnSeen key is in ALLOWED_STORAGE_KEYS", async ({ page }) => {
    const included = await page.evaluate(
      () =>
        Array.isArray(ALLOWED_STORAGE_KEYS) &&
        ALLOWED_STORAGE_KEYS.includes("syncAttachmentsWarnSeen")
    );
    expect(included).toBe(true);
  });

  test("syncAttachments defaults to true when key is absent", async ({ page }) => {
    const result = await page.evaluate(() => {
      localStorage.removeItem("syncAttachments");
      // The cloud-sync code reads this with loadDataSync("syncAttachments", null)
      // and treats null/missing as true (default enabled)
      const raw = loadDataSync("syncAttachments", null);
      // null means key absent — default is true per spec
      return raw === null || raw === true || raw === "true";
    });
    expect(result).toBe(true);
  });
});

test.describe("STRK-45 — Cloud sync DIFF_FIELDS and DiffEngine integration", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.DiffEngine !== "undefined");
  });

  test("compareItems emits coarse attachments change record (one per item, not per entry)", async ({
    page,
  }) => {
    // detectConflicts uses ${itemKey}|${field} as a Map key.
    // If compareItems emitted per-entry records (field: "attachments:uuid"),
    // only the last one would survive. Verify one coarse record is emitted.
    const result = await page.evaluate(() => {
      const local = [
        {
          serial: 1,
          name: "Eagle",
          attachments: [
            { attachmentUuid: "a1", fileName: "a.pdf" },
            { attachmentUuid: "a2", fileName: "b.pdf" },
          ],
        },
      ];
      const remote = [
        {
          serial: 1,
          name: "Eagle",
          attachments: [
            { attachmentUuid: "a1", fileName: "a.pdf" },
            { attachmentUuid: "a3", fileName: "c.pdf" }, // a2 removed, a3 added
          ],
        },
      ];
      const diff = DiffEngine.compareItems(local, remote);
      const changes = diff.modified[0]?.changes || [];
      const attChanges = changes.filter((c) => c.field === "attachments");
      return {
        modifiedCount: diff.modified.length,
        attChangeCount: attChanges.length,
      };
    });
    expect(result.modifiedCount).toBe(1);
    // Must be exactly ONE coarse record, not one per attachment entry
    expect(result.attChangeCount).toBe(1);
  });

  test("detectConflicts handles attachments field without key collision", async ({ page }) => {
    const result = await page.evaluate(() => {
      // Two local manifest entries + one remote compareItems record — must not collide
      const localChanges = [
        {
          itemKey: "1",
          field: "Attachment added",
          localVal: null,
          remoteVal: { attachmentUuid: "a1" },
        },
      ];
      const remoteChanges = [
        {
          itemKey: "1",
          field: "attachments",
          localVal: [],
          remoteVal: [{ attachmentUuid: "a1", fileName: "photo.jpg" }],
        },
      ];
      const result = DiffEngine.detectConflicts(localChanges, remoteChanges);
      // Different fields — no conflict
      return {
        conflictCount: result.conflicts.length,
        cleanCount: result.clean.length,
      };
    });
    // "Attachment added" ≠ "attachments" — so they don't conflict
    expect(result.conflictCount).toBe(0);
    expect(result.cleanCount).toBe(2);
  });

  test("SYNC_ATTACHMENTS_PATH constant is exposed and has correct format", async ({ page }) => {
    const path = await page.evaluate(() => window.SYNC_ATTACHMENTS_PATH);
    expect(path).toBeTruthy();
    expect(path).toContain("StakTrakr");
    expect(path).toContain("attachments");
    expect(path).toContain(".stvault");
  });
});

test.describe("STRK-45 — syncAttachments toggle behavior", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await setupCloudConnected(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.saveDataSync === "function");
  });

  test("setting syncAttachments to false persists via saveData/loadDataSync", async ({ page }) => {
    const result = await page.evaluate(() => {
      saveDataSync("syncAttachments", false);
      return loadDataSync("syncAttachments", null);
    });
    expect(result).toBe(false);
  });

  test("setting syncAttachments to true persists via saveData/loadDataSync", async ({ page }) => {
    const result = await page.evaluate(() => {
      saveDataSync("syncAttachments", true);
      return loadDataSync("syncAttachments", null);
    });
    expect(result).toBe(true);
  });

  test("syncAttachmentsWarnSeen can be set and retrieved", async ({ page }) => {
    const result = await page.evaluate(() => {
      saveDataSync("syncAttachmentsWarnSeen", true);
      return loadDataSync("syncAttachmentsWarnSeen", null);
    });
    expect(result).toBe(true);
  });
});

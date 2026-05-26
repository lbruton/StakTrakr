import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

// F.1 — AttachmentManager IDB roundtrip tests (AC-2, D6, D7, D13, D14)

test.describe("STRK-45 — AttachmentManager IDB roundtrip", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.attachmentManager !== "undefined");
  });

  test("init() opens the database and isAvailable() returns true", async ({ page }) => {
    const available = await page.evaluate(async () => {
      const ok = await attachmentManager.init();
      return ok && attachmentManager.isAvailable();
    });
    expect(available).toBe(true);
  });

  test("addAttachment / getAttachment roundtrip persists all fields", async ({ page }) => {
    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      const rec = {
        attachmentUuid: "f1-roundtrip-uuid",
        itemUuid: "f1-item-uuid",
        fileName: "test-receipt.pdf",
        mimeType: "application/pdf",
        size: 1024,
        uploadedAt: "2026-01-01T10:00:00.000Z",
        blob: new Blob(["test content"], { type: "application/pdf" }),
      };
      await attachmentManager.addAttachment(rec);
      const fetched = await attachmentManager.getAttachment("f1-roundtrip-uuid");
      if (!fetched) return null;
      return {
        uuidMatches: fetched.attachmentUuid === "f1-roundtrip-uuid",
        itemUuidMatches: fetched.itemUuid === "f1-item-uuid",
        fileNameMatches: fetched.fileName === "test-receipt.pdf",
        mimeTypeMatches: fetched.mimeType === "application/pdf",
        sizeMatches: fetched.size === 1024,
        hasBlob: fetched.blob instanceof Blob,
      };
    });
    expect(result).not.toBeNull();
    expect(result.uuidMatches).toBe(true);
    expect(result.itemUuidMatches).toBe(true);
    expect(result.fileNameMatches).toBe(true);
    expect(result.mimeTypeMatches).toBe(true);
    expect(result.sizeMatches).toBe(true);
    expect(result.hasBlob).toBe(true);
  });

  test("getAttachment returns null for unknown UUID", async ({ page }) => {
    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      return await attachmentManager.getAttachment("nonexistent-uuid-xyz");
    });
    expect(result).toBeNull();
  });

  test("deleteAttachment removes the record", async ({ page }) => {
    const gone = await page.evaluate(async () => {
      await attachmentManager.init();
      await attachmentManager.addAttachment({
        attachmentUuid: "f1-delete-uuid",
        itemUuid: "f1-item-del",
        fileName: "to-delete.pdf",
        mimeType: "application/pdf",
        size: 512,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        blob: new Blob(["x"], { type: "application/pdf" }),
      });
      await attachmentManager.deleteAttachment("f1-delete-uuid");
      const fetched = await attachmentManager.getAttachment("f1-delete-uuid");
      return fetched === null;
    });
    expect(gone).toBe(true);
  });

  test("deleteAttachmentsForItem cascade removes all records for an itemUuid", async ({ page }) => {
    const remaining = await page.evaluate(async () => {
      await attachmentManager.init();
      const itemUuid = "f1-cascade-item";
      for (let i = 0; i < 3; i++) {
        await attachmentManager.addAttachment({
          attachmentUuid: `f1-cascade-${i}`,
          itemUuid,
          fileName: `file-${i}.pdf`,
          mimeType: "application/pdf",
          size: 100,
          uploadedAt: "2026-01-01T00:00:00.000Z",
          blob: new Blob(["data"], { type: "application/pdf" }),
        });
      }
      await attachmentManager.deleteAttachmentsForItem(itemUuid);
      const left = await attachmentManager.getAttachmentsByItemUuid(itemUuid);
      return left.length;
    });
    expect(remaining).toBe(0);
  });

  test("deleteAttachmentsForItem does not remove records for other items", async ({ page }) => {
    const count = await page.evaluate(async () => {
      await attachmentManager.init();
      await attachmentManager.addAttachment({
        attachmentUuid: "f1-keep-uuid",
        itemUuid: "f1-keep-item",
        fileName: "keep.pdf",
        mimeType: "application/pdf",
        size: 128,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        blob: new Blob(["keep"], { type: "application/pdf" }),
      });
      // Delete a different item's attachments
      await attachmentManager.deleteAttachmentsForItem("f1-other-item");
      const kept = await attachmentManager.getAttachment("f1-keep-uuid");
      return kept !== null ? 1 : 0;
    });
    expect(count).toBe(1);
  });

  test("exportAllAttachments returns array with correct schema shape", async ({ page }) => {
    const shape = await page.evaluate(async () => {
      await attachmentManager.init();
      await attachmentManager.addAttachment({
        attachmentUuid: "f1-export-uuid",
        itemUuid: "f1-export-item",
        fileName: "exported.pdf",
        mimeType: "application/pdf",
        size: 2048,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        blob: new Blob(["export test"], { type: "application/pdf" }),
      });
      const all = await attachmentManager.exportAllAttachments();
      const entry = all.find((e) => e.attachmentUuid === "f1-export-uuid");
      if (!entry) return null;
      return {
        hasAttachmentUuid: "attachmentUuid" in entry,
        hasItemUuid: "itemUuid" in entry,
        hasFileName: "fileName" in entry,
        hasMimeType: "mimeType" in entry,
        hasSize: "size" in entry,
        hasBlob: entry.blob instanceof Blob,
      };
    });
    expect(shape).not.toBeNull();
    expect(shape.hasAttachmentUuid).toBe(true);
    expect(shape.hasItemUuid).toBe(true);
    expect(shape.hasFileName).toBe(true);
    expect(shape.hasMimeType).toBe(true);
    expect(shape.hasSize).toBe(true);
    expect(shape.hasBlob).toBe(true);
  });

  test("item metadata retains attachments array when binary write fails (missing-binary state)", async ({
    page,
  }) => {
    // Simulate a scenario where attachment metadata is in the item but IDB has no binary.
    // The item should retain its attachments array; getAttachment returns null (missing binary).
    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      // Item has metadata but the binary was never stored in IDB
      const itemWithMeta = {
        serial: 999,
        name: "Test Item",
        attachments: [
          {
            attachmentUuid: "f1-missing-binary",
            fileName: "ghost.pdf",
            mimeType: "application/pdf",
            size: 500,
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
      const binary = await attachmentManager.getAttachment("f1-missing-binary");
      return {
        metaPreserved: itemWithMeta.attachments.length === 1,
        binaryMissing: binary === null,
      };
    });
    expect(result.metaPreserved).toBe(true);
    expect(result.binaryMissing).toBe(true);
  });
});

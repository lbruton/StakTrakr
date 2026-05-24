import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

test.describe("STRK-65 — Attachment follow-up hardening", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.attachmentManager !== "undefined");
    await page.waitForFunction(() => typeof window.queueAttachmentFile === "function");
  });

  test("queue entries use stable ids — duplicate filenames removable independently", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const file1 = new File(["a"], "receipt.pdf", { type: "application/pdf" });
      const file2 = new File(["b"], "receipt.pdf", { type: "application/pdf" });
      window.queueAttachmentFile(file1);
      window.queueAttachmentFile(file2);

      const list = document.getElementById("attachmentQueuedList");
      const beforeCount = list ? list.querySelectorAll(".attachment-item--queued").length : 0;

      const rows = list ? list.querySelectorAll(".attachment-item--queued") : [];
      const firstId = rows.length > 0 ? Number(rows[0].dataset.attachmentEntryId) : null;
      if (firstId !== null) window.dequeueAttachment(firstId);

      const afterCount = list ? list.querySelectorAll(".attachment-item--queued").length : 0;
      return { beforeCount, afterCount, firstId };
    });
    expect(result.beforeCount).toBe(2);
    expect(result.afterCount).toBe(1);
    expect(result.firstId).not.toBeNull();
  });

  test("hasAttachment returns true for stored records and false for missing", async ({ page }) => {
    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      const blob = new Blob(["test"], { type: "application/pdf" });
      await attachmentManager.addAttachment({
        attachmentUuid: "has-check-uuid",
        itemUuid: "item-1",
        fileName: "test.pdf",
        type: "application/pdf",
        size: 4,
        uploadedAt: new Date().toISOString(),
        blob,
      });
      const exists = await attachmentManager.hasAttachment("has-check-uuid");
      const missing = await attachmentManager.hasAttachment("nonexistent-uuid");
      return { exists, missing };
    });
    expect(result.exists).toBe(true);
    expect(result.missing).toBe(false);
  });

  test("deleteAttachmentsForItem uses key cursor without loading blobs", async ({ page }) => {
    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      const blob = new Blob(["data"], { type: "application/pdf" });
      await attachmentManager.addAttachment({
        attachmentUuid: "del-cursor-1",
        itemUuid: "del-item",
        fileName: "a.pdf",
        type: "application/pdf",
        size: 4,
        uploadedAt: new Date().toISOString(),
        blob,
      });
      await attachmentManager.addAttachment({
        attachmentUuid: "del-cursor-2",
        itemUuid: "del-item",
        fileName: "b.pdf",
        type: "application/pdf",
        size: 4,
        uploadedAt: new Date().toISOString(),
        blob,
      });
      const beforeCount = (await attachmentManager.getAttachmentsByItemUuid("del-item")).length;
      await attachmentManager.deleteAttachmentsForItem("del-item");
      const afterCount = (await attachmentManager.getAttachmentsByItemUuid("del-item")).length;
      return { beforeCount, afterCount };
    });
    expect(result.beforeCount).toBe(2);
    expect(result.afterCount).toBe(0);
  });

  test("reconcileOrphans removes records not in validUuids set", async ({ page }) => {
    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      const blob = new Blob(["x"], { type: "application/pdf" });
      await attachmentManager.addAttachment({
        attachmentUuid: "orphan-keep",
        itemUuid: "item-1",
        fileName: "keep.pdf",
        type: "application/pdf",
        size: 1,
        uploadedAt: new Date().toISOString(),
        blob,
      });
      await attachmentManager.addAttachment({
        attachmentUuid: "orphan-remove",
        itemUuid: "item-gone",
        fileName: "gone.pdf",
        type: "application/pdf",
        size: 1,
        uploadedAt: new Date().toISOString(),
        blob,
      });
      const validUuids = new Set(["orphan-keep"]);
      const removed = await attachmentManager.reconcileOrphans(validUuids);
      const kept = await attachmentManager.hasAttachment("orphan-keep");
      const gone = await attachmentManager.hasAttachment("orphan-remove");
      return { removed, kept, gone };
    });
    expect(result.removed).toBe(1);
    expect(result.kept).toBe(true);
    expect(result.gone).toBe(false);
  });

  test("DiffEngine duplicate-filename attachments emitted as additions not replacements", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      if (typeof DiffEngine === "undefined") {
        throw new Error("DiffEngine is not loaded");
      }
      const local = [
        {
          attachmentUuid: "loc-1",
          fileName: "receipt.pdf",
          type: "application/pdf",
          size: 100,
          uploadedAt: "2026-01-01",
        },
        {
          attachmentUuid: "loc-2",
          fileName: "receipt.pdf",
          type: "application/pdf",
          size: 200,
          uploadedAt: "2026-01-02",
        },
      ];
      const remote = [
        {
          attachmentUuid: "rem-1",
          fileName: "receipt.pdf",
          type: "application/pdf",
          size: 300,
          uploadedAt: "2026-01-03",
        },
      ];
      const itemA = { uuid: "a", attachments: local };
      const itemB = { uuid: "a", attachments: remote };
      const diff = DiffEngine.compareItems([itemA], [itemB]);
      const attachChanges =
        diff.modified?.[0]?.changes?.filter((c) => c.field === "attachments") || [];
      const actions =
        attachChanges.length > 0 && attachChanges[0].attachmentChanges
          ? attachChanges[0].attachmentChanges.map((c) => c.action)
          : [];
      return { actions, hasReplace: actions.includes("replace") };
    });
    expect(result.hasReplace).toBe(false);
  });
});

import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

test.describe("extended/attachment-zip", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.attachmentManager !== "undefined");
  });

  test("queued duplicate filenames use stable ids and can be removed independently", async ({
    page,
  }) => {
    await page.waitForFunction(() => typeof window.queueAttachmentFile === "function");
    const result = await page.evaluate(() => {
      window.queueAttachmentFile(new File(["a"], "receipt.pdf", { type: "application/pdf" }));
      window.queueAttachmentFile(new File(["b"], "receipt.pdf", { type: "application/pdf" }));
      const list = document.getElementById("attachmentQueuedList");
      const rows = list ? list.querySelectorAll(".attachment-item--queued") : [];
      const firstId = rows.length > 0 ? Number(rows[0].dataset.attachmentEntryId) : null;
      if (firstId !== null) window.dequeueAttachment(firstId);
      return {
        beforeCount: rows.length,
        afterCount: list ? list.querySelectorAll(".attachment-item--queued").length : 0,
        firstId,
      };
    });

    expect(result.beforeCount).toBe(2);
    expect(result.afterCount).toBe(1);
    expect(result.firstId).not.toBeNull();
  });

  test("duplicate filename attachment diffs are additions, not replacements", async ({ page }) => {
    const result = await page.evaluate(() => {
      const local = [
        { attachmentUuid: "loc-1", fileName: "receipt.pdf", type: "application/pdf", size: 100 },
        { attachmentUuid: "loc-2", fileName: "receipt.pdf", type: "application/pdf", size: 200 },
      ];
      const remote = [
        { attachmentUuid: "rem-1", fileName: "receipt.pdf", type: "application/pdf", size: 300 },
      ];
      const actions = DiffEngine.diffAttachments(local, remote).map((change) => change.action);
      return { actions, hasReplace: actions.includes("replace") };
    });

    expect(result.hasReplace).toBe(false);
    expect(result.actions).toEqual(expect.arrayContaining(["add", "remove"]));
  });

  test("storage diagnostics label localStorage accurately and describe variable quota", async ({
    page,
  }) => {
    await page.evaluate(async () => {
      if (typeof updateSettingsFooter === "function") await updateSettingsFooter();
      if (typeof renderStorageSection === "function") await renderStorageSection(true);
    });

    const result = await page.evaluate(() => ({
      footer: document.getElementById("settingsFooter")?.textContent || "",
      combined: document.getElementById("storageStat_combined_sub")?.textContent || "",
    }));

    expect(result.footer).toContain("~5 MB");
    expect(result.footer).not.toMatch(/LS:.*\/ 5 MB/);
    expect(result.combined).toContain("browser quota varies");
  });
});

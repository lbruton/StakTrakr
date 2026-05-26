import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

// F.5 — DiffEngine attachment diff support (AC-6, D8)

test.describe("STRK-45 — DiffEngine.diffAttachments", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.DiffEngine !== "undefined");
  });

  test("DIFF_FIELDS includes 'attachments' — compareItems detects array changes", async ({
    page,
  }) => {
    const modified = await page.evaluate(() => {
      const local = [
        {
          serial: 1,
          name: "Eagle",
          attachments: [{ attachmentUuid: "old-uuid", fileName: "a.pdf" }],
        },
      ];
      const remote = [
        {
          serial: 1,
          name: "Eagle",
          attachments: [{ attachmentUuid: "new-uuid", fileName: "a.pdf" }],
        },
      ];
      const result = DiffEngine.compareItems(local, remote);
      const hasField =
        result.modified.length === 1 &&
        result.modified[0].changes.some((c) => c.field === "attachments");
      return { modifiedCount: result.modified.length, hasAttachmentsField: hasField };
    });
    expect(modified.modifiedCount).toBe(1);
    expect(modified.hasAttachmentsField).toBe(true);
  });

  test("compareItems does not flag attachments as modified when arrays are identical", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const atts = [{ attachmentUuid: "same-uuid", fileName: "same.pdf" }];
      const local = [{ serial: 1, name: "Eagle", attachments: atts }];
      const remote = [{ serial: 1, name: "Eagle", attachments: atts }];
      const diff = DiffEngine.compareItems(local, remote);
      return { unchangedCount: diff.unchanged.length, modifiedCount: diff.modified.length };
    });
    expect(result.unchangedCount).toBe(1);
    expect(result.modifiedCount).toBe(0);
  });

  test("diffAttachments detects pure addition", async ({ page }) => {
    const result = await page.evaluate(() => {
      return DiffEngine.diffAttachments(
        [],
        [{ attachmentUuid: "new-uuid", fileName: "photo.jpg", mimeType: "image/jpeg", size: 1024 }]
      );
    });
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("add");
    expect(result[0].attachmentUuid).toBe("new-uuid");
    expect(result[0].localVal).toBeNull();
    expect(result[0].remoteVal).not.toBeNull();
  });

  test("diffAttachments detects pure removal", async ({ page }) => {
    const result = await page.evaluate(() => {
      return DiffEngine.diffAttachments(
        [
          {
            attachmentUuid: "old-uuid",
            fileName: "receipt.pdf",
            mimeType: "application/pdf",
            size: 2048,
          },
        ],
        []
      );
    });
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("remove");
    expect(result[0].attachmentUuid).toBe("old-uuid");
    expect(result[0].remoteVal).toBeNull();
    expect(result[0].localVal).not.toBeNull();
  });

  test("diffAttachments detects replacement — same fileName different UUID renders as 'replace' not add+remove", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return DiffEngine.diffAttachments(
        [
          {
            attachmentUuid: "uuid-v1",
            fileName: "cert.pdf",
            mimeType: "application/pdf",
            size: 1024,
          },
        ],
        [
          {
            attachmentUuid: "uuid-v2",
            fileName: "cert.pdf",
            mimeType: "application/pdf",
            size: 2048,
          },
        ]
      );
    });
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("replace");
    expect(result[0].attachmentUuid).toBe("uuid-v2");
    expect(result[0].oldAttachmentUuid).toBe("uuid-v1");
    expect(result[0].localVal).not.toBeNull();
    expect(result[0].remoteVal).not.toBeNull();
  });

  test("diffAttachments returns empty array for identical attachment lists", async ({ page }) => {
    const result = await page.evaluate(() => {
      const atts = [{ attachmentUuid: "same-uuid", fileName: "photo.jpg", size: 512 }];
      return DiffEngine.diffAttachments(atts, atts);
    });
    expect(result).toHaveLength(0);
  });

  test("diffAttachments handles mixed add/remove/replace in a single call", async ({ page }) => {
    const result = await page.evaluate(() => {
      const local = [
        { attachmentUuid: "keep-uuid", fileName: "keep.pdf", size: 100 },
        { attachmentUuid: "old-cert", fileName: "cert.pdf", size: 500 },
        { attachmentUuid: "remove-uuid", fileName: "remove.pdf", size: 200 },
      ];
      const remote = [
        { attachmentUuid: "keep-uuid", fileName: "keep.pdf", size: 100 },
        { attachmentUuid: "new-cert", fileName: "cert.pdf", size: 600 },
        { attachmentUuid: "add-uuid", fileName: "new.pdf", size: 300 },
      ];
      const diffs = DiffEngine.diffAttachments(local, remote);
      return {
        total: diffs.length,
        actions: diffs.map((d) => d.action).sort(),
      };
    });
    expect(result.total).toBe(3);
    expect(result.actions).toEqual(["add", "remove", "replace"]);
  });
});

test.describe("STRK-45 — applySelectedChanges attach-entry", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.DiffEngine !== "undefined");
  });

  test("apply attach-entry add appends the new attachment", async ({ page }) => {
    const result = await page.evaluate(() => {
      const inventory = [{ serial: 1, name: "Eagle", attachments: [] }];
      const changes = [
        {
          type: "attach-entry",
          itemKey: "1",
          action: "add",
          attachmentUuid: "new-att-uuid",
          oldAttachmentUuid: null,
          value: {
            attachmentUuid: "new-att-uuid",
            fileName: "proof.pdf",
            mimeType: "application/pdf",
            size: 512,
          },
        },
      ];
      return DiffEngine.applySelectedChanges(inventory, changes)[0].attachments;
    });
    expect(result).toHaveLength(1);
    expect(result[0].attachmentUuid).toBe("new-att-uuid");
  });

  test("apply attach-entry remove deletes the attachment by UUID", async ({ page }) => {
    const result = await page.evaluate(() => {
      const inventory = [
        {
          serial: 1,
          name: "Eagle",
          attachments: [{ attachmentUuid: "att-to-remove", fileName: "old.pdf" }],
        },
      ];
      const changes = [
        {
          type: "attach-entry",
          itemKey: "1",
          action: "remove",
          attachmentUuid: "att-to-remove",
          oldAttachmentUuid: null,
          value: null,
        },
      ];
      return DiffEngine.applySelectedChanges(inventory, changes)[0].attachments;
    });
    expect(result).toHaveLength(0);
  });

  test("apply attach-entry replace swaps old UUID with new in-place", async ({ page }) => {
    const result = await page.evaluate(() => {
      const inventory = [
        {
          serial: 1,
          name: "Eagle",
          attachments: [{ attachmentUuid: "uuid-old", fileName: "cert.pdf", size: 1024 }],
        },
      ];
      const changes = [
        {
          type: "attach-entry",
          itemKey: "1",
          action: "replace",
          attachmentUuid: "uuid-new",
          oldAttachmentUuid: "uuid-old",
          value: { attachmentUuid: "uuid-new", fileName: "cert.pdf", size: 2048 },
        },
      ];
      return DiffEngine.applySelectedChanges(inventory, changes)[0].attachments;
    });
    expect(result).toHaveLength(1);
    expect(result[0].attachmentUuid).toBe("uuid-new");
    expect(result[0].size).toBe(2048);
  });

  test("apply attach-entry does not duplicate on idempotent add", async ({ page }) => {
    const result = await page.evaluate(() => {
      const att = { attachmentUuid: "dup-uuid", fileName: "dup.pdf", size: 100 };
      const inventory = [{ serial: 1, name: "Eagle", attachments: [att] }];
      const changes = [
        {
          type: "attach-entry",
          itemKey: "1",
          action: "add",
          attachmentUuid: "dup-uuid",
          oldAttachmentUuid: null,
          value: att,
        },
      ];
      return DiffEngine.applySelectedChanges(inventory, changes)[0].attachments.length;
    });
    expect(result).toBe(1);
  });

  test("apply attach-entry replace falls back to append when oldUuid not found", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const inventory = [{ serial: 1, name: "Eagle", attachments: [] }];
      const changes = [
        {
          type: "attach-entry",
          itemKey: "1",
          action: "replace",
          attachmentUuid: "fallback-new",
          oldAttachmentUuid: "gone-old",
          value: { attachmentUuid: "fallback-new", fileName: "fallback.pdf", size: 200 },
        },
      ];
      return DiffEngine.applySelectedChanges(inventory, changes)[0].attachments;
    });
    expect(result).toHaveLength(1);
    expect(result[0].attachmentUuid).toBe("fallback-new");
  });
});

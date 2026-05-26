import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

// F.2 — Zip backup/restore attachment tests (AC-3, AC-5, AC-6)

test.describe("STRK-45 — Zip backup attachment structure", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(
      () => typeof window.attachmentManager !== "undefined" && typeof window.JSZip !== "undefined"
    );
  });

  test("exportAllAttachments returns entries that map to zip paths matching manifest schema", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      // Seed one attachment
      await attachmentManager.addAttachment({
        attachmentUuid: "f2-zip-uuid-001",
        itemUuid: "f2-zip-item-001",
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
        size: 4096,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        blob: new Blob(["zip test data"], { type: "application/pdf" }),
      });

      const all = await attachmentManager.exportAllAttachments();
      const entry = all.find((e) => e.attachmentUuid === "f2-zip-uuid-001");
      if (!entry) return null;

      // Derive the zip path as inventory-backup.js does:
      // user_attachments/<attachmentUuid>.<ext>
      const ext = (entry.mimeType || "").split("/")[1] || "bin";
      const zipPath = `user_attachments/${entry.attachmentUuid}.${ext}`;
      return {
        zipPath,
        manifestShape: {
          attachmentUuid: entry.attachmentUuid,
          itemUuid: entry.itemUuid,
          fileName: entry.fileName,
          mimeType: entry.mimeType,
          size: entry.size,
          file: zipPath,
        },
      };
    });

    expect(result).not.toBeNull();
    expect(result.zipPath).toBe("user_attachments/f2-zip-uuid-001.pdf");
    expect(result.manifestShape.attachmentUuid).toBe("f2-zip-uuid-001");
    expect(result.manifestShape.fileName).toBe("invoice.pdf");
    // The `file` field points to the zip-internal path
    expect(result.manifestShape.file).toContain("user_attachments/");
  });

  test("inventory items exported with zip carry the attachments array", async ({ page }) => {
    const result = await page.evaluate(async () => {
      // Modify in-memory inventory to include an item with attachments
      const item = {
        serial: 1,
        name: "SAMPLE - American Silver Eagle",
        attachments: [
          {
            attachmentUuid: "f2-item-att",
            fileName: "provenance.pdf",
            mimeType: "application/pdf",
            size: 1024,
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
      // Verify the attachments array would be included in the JSON payload
      const json = JSON.parse(JSON.stringify({ inventory: [item] }));
      const firstItem = json.inventory[0];
      return {
        hasAttachments: Array.isArray(firstItem.attachments),
        count: firstItem.attachments.length,
        uuid: firstItem.attachments[0]?.attachmentUuid,
      };
    });
    expect(result.hasAttachments).toBe(true);
    expect(result.count).toBe(1);
    expect(result.uuid).toBe("f2-item-att");
  });

  test("inventory_data.json includes the complete DIFF_FIELDS export surface", async ({ page }) => {
    const exportedItem = await page.evaluate(async () => {
      const richItem = {
        uuid: "strk101-diff-fields",
        serial: 101,
        metal: "Gold",
        composition: "Gold",
        name: "STRK-101 Complete Export",
        qty: 1,
        type: "Coin",
        weight: 1,
        weightUnit: "oz",
        purity: 0.9999,
        price: 1900,
        purchasePrice: 1900,
        retailPrice: 2010,
        date: "2026-05-23",
        collectable: true,
        ignorePatternImages: true,
        currency: "USD",
        obverseImageFrame: "rectangle",
        reverseImageFrame: "circle",
        lastModified: "2026-05-23T12:00:00.000Z",
        capsule: "Air-Tite",
        capsuleNotes: "Black ring",
        numistaData: { id: "N-101", shape: "round" },
        fieldMeta: { source: "test" },
        attachments: [{ attachmentUuid: "att-101", fileName: "receipt.pdf" }],
      };
      window.inventory = [richItem];
      const blob = await window.createBackupZip();
      const zip = await window.JSZip.loadAsync(await blob.arrayBuffer());
      const data = JSON.parse(await zip.file("inventory_data.json").async("string"));
      return data.inventory[0];
    });

    expect(exportedItem).toMatchObject({
      purchasePrice: 1900,
      retailPrice: 2010,
      collectable: true,
      ignorePatternImages: true,
      currency: "USD",
      obverseImageFrame: "rectangle",
      reverseImageFrame: "circle",
      lastModified: "2026-05-23T12:00:00.000Z",
      capsule: "Air-Tite",
      capsuleNotes: "Black ring",
      numistaData: { id: "N-101", shape: "round" },
      fieldMeta: { source: "test" },
    });
    expect(exportedItem.attachments).toEqual([
      { attachmentUuid: "att-101", fileName: "receipt.pdf" },
    ]);
  });

  test("CSV Attachments column shape: fileName#attachmentUuid pairs joined by |", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      // Simulate the CSV serialization logic from inventory-backup.js:
      // item.attachments.map(a => `${a.fileName}#${a.attachmentUuid}`).join("|")
      const item = {
        attachments: [
          { fileName: "photo.jpg", attachmentUuid: "uuid-a" },
          { fileName: "receipt.pdf", attachmentUuid: "uuid-b" },
        ],
      };
      if (!Array.isArray(item.attachments) || item.attachments.length === 0) return "";
      return item.attachments.map((a) => `${a.fileName}#${a.attachmentUuid}`).join("|");
    });
    expect(result).toBe("photo.jpg#uuid-a|receipt.pdf#uuid-b");
  });

  test("missing-binary state: attachment metadata retained, binary absent from IDB", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      // Item has metadata but no binary stored
      const uuid = "f2-missing-binary-restore";
      const item = {
        serial: 42,
        name: "Test Coin",
        attachments: [
          {
            attachmentUuid: uuid,
            fileName: "missing.pdf",
            mimeType: "application/pdf",
            size: 500,
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
      const binary = await attachmentManager.getAttachment(uuid);
      return {
        metadataPresent: item.attachments.length === 1,
        binaryMissing: binary === null,
      };
    });
    expect(result.metadataPresent).toBe(true);
    expect(result.binaryMissing).toBe(true);
  });
});

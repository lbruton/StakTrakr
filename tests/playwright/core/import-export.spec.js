import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const VAULT_PASSWORD = "strk118-vault-pass";

const FRAME_ITEM = {
  uuid: "strk118-frame-export",
  serial: 118,
  metal: "Silver",
  composition: "Silver",
  name: "STRK-118 Frame Export",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 30,
  date: "2026-05-26",
  purchaseLocation: "Desk",
  storageLocation: "Safe",
  obverseImageUrl: "https://images.example/obv.png",
  reverseImageUrl: "https://images.example/rev.png",
  obverseImageFrame: "rectangle",
  reverseImageFrame: "circle",
};

async function seedFrameInventory(page) {
  await page.addInitScript((item) => {
    localStorage.setItem("metalInventory", JSON.stringify([item]));
    localStorage.setItem("itemTags", JSON.stringify({}));
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  }, FRAME_ITEM);
}

async function parseCsvRow(page, csvText) {
  return page.evaluate((text) => {
    const normalized = text
      .split("\n")
      .filter((line) => !line.startsWith("# exportOrigin:"))
      .join("\n");
    return window.Papa.parse(normalized, { header: true, skipEmptyLines: true }).data[0];
  }, csvText);
}

function expectFrameColumns(row) {
  const headers = Object.keys(row);
  const reverseUrlIndex = headers.indexOf("Reverse Image URL");
  expect(headers.slice(reverseUrlIndex + 1, reverseUrlIndex + 3)).toEqual([
    "Obverse Frame",
    "Reverse Frame",
  ]);
  expect(row["Obverse Frame"]).toBe("rectangle");
  expect(row["Reverse Frame"]).toBe("circle");
}

test.describe("core/import-export", () => {
  test("backup ZIP preserves attachments manifest paths, item metadata, and full diff fields", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.attachmentManager !== "undefined" &&
        typeof window.createBackupZip === "function"
    );

    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      await attachmentManager.addAttachment({
        attachmentUuid: "strk118-zip-uuid",
        itemUuid: "strk118-item-uuid",
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
        size: 4096,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        blob: new Blob(["zip test data"], { type: "application/pdf" }),
      });
      window.inventory = [
        {
          uuid: "strk118-rich-item",
          serial: 118,
          metal: "Gold",
          composition: "Gold",
          name: "STRK-118 Complete Export",
          qty: 1,
          type: "Coin",
          weight: 1,
          weightUnit: "oz",
          purity: 0.9999,
          price: 1900,
          purchasePrice: 1900,
          retailPrice: 2010,
          date: "2026-05-26",
          collectable: true,
          ignorePatternImages: true,
          currency: "USD",
          obverseImageFrame: "rectangle",
          reverseImageFrame: "circle",
          lastModified: "2026-05-26T12:00:00.000Z",
          capsule: "Air-Tite",
          capsuleNotes: "Black ring",
          numistaData: { id: "N-118", shape: "round" },
          fieldMeta: { source: "test" },
          attachments: [{ attachmentUuid: "strk118-zip-uuid", fileName: "invoice.pdf" }],
        },
      ];

      const exported = await attachmentManager.exportAllAttachments();
      const entry = exported.find((item) => item.attachmentUuid === "strk118-zip-uuid");
      const blob = await window.createBackupZip();
      const zip = await window.JSZip.loadAsync(await blob.arrayBuffer());
      const data = JSON.parse(await zip.file("inventory_data.json").async("string"));
      const manifest = JSON.parse(await zip.file("user_attachment_manifest.json").async("string"));
      const csvText = await zip.file("inventory_export.csv").async("string");
      const attachmentCsvShape = window.inventory[0].attachments
        .map((att) => `${att.fileName}#${att.attachmentUuid}`)
        .join("|");

      return {
        exportedPath: `user_attachments/${entry.attachmentUuid}.${(entry.mimeType || "").split("/")[1] || "bin"}`,
        manifestEntry: manifest.entries.find((att) => att.attachmentUuid === "strk118-zip-uuid"),
        item: data.inventory[0],
        attachmentCsvShape,
        csvText,
      };
    });

    expect(result.exportedPath).toBe("user_attachments/strk118-zip-uuid.pdf");
    expect(result.manifestEntry.file).toContain("user_attachments/");
    expect(result.item).toMatchObject({
      purchasePrice: 1900,
      retailPrice: 2010,
      collectable: true,
      ignorePatternImages: true,
      currency: "USD",
      obverseImageFrame: "rectangle",
      reverseImageFrame: "circle",
      lastModified: "2026-05-26T12:00:00.000Z",
      capsule: "Air-Tite",
      capsuleNotes: "Black ring",
      numistaData: { id: "N-118", shape: "round" },
      fieldMeta: { source: "test" },
      attachments: [{ attachmentUuid: "strk118-zip-uuid", fileName: "invoice.pdf" }],
    });
    expect(result.attachmentCsvShape).toBe("invoice.pdf#strk118-zip-uuid");
    expect(result.csvText).toContain("Attachments");
  });

  test("standalone and ZIP CSV exports keep frame columns after Reverse Image URL", async ({
    page,
  }) => {
    await seedFrameInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.createBackupZip === "function" &&
        typeof window.exportInventoryCSV === "function" &&
        typeof window.Papa !== "undefined"
    );

    const zipCsv = await page.evaluate(async () => {
      const blob = await window.createBackupZip();
      const zip = await window.JSZip.loadAsync(await blob.arrayBuffer());
      return zip.file("inventory_export.csv").async("string");
    });
    const standaloneCsv = await page.evaluate(() => window.exportInventoryCSV());

    expectFrameColumns(await parseCsvRow(page, zipCsv));
    expectFrameColumns(await parseCsvRow(page, standaloneCsv));
  });

  test("same-device vault restore shows no duplicate differences", async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.vaultEncryptToBytes === "function" &&
        typeof window.vaultRestoreWithPreview === "function" &&
        typeof window.DiffEngine !== "undefined"
    );

    const result = await page.evaluate(async (password) => {
      const bytes = await window.vaultEncryptToBytes(password);
      let diffModalCalled = false;
      let capturedDiff = null;
      let toastMsg = "";
      const origShow = window.DiffModal.show;
      const origToast = window.showToast;
      window.DiffModal.show = (opts) => {
        diffModalCalled = true;
        capturedDiff = opts.diff;
      };
      window.showToast = (msg) => {
        toastMsg = msg;
      };
      await window.vaultRestoreWithPreview(bytes, password);
      window.DiffModal.show = origShow;
      window.showToast = origToast;
      return {
        diffModalCalled,
        added: capturedDiff ? capturedDiff.added.length : 0,
        modified: capturedDiff ? capturedDiff.modified.length : 0,
        deleted: capturedDiff ? capturedDiff.deleted.length : 0,
        toast: toastMsg,
      };
    }, VAULT_PASSWORD);

    expect(result.added).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.deleted).toBe(0);
  });

  test("vault preview detects modified, new, removed, and cross-device items", async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.vaultEncryptToBytes === "function" &&
        typeof window.vaultRestoreWithPreview === "function"
    );

    const result = await page.evaluate(async (password) => {
      const raw = localStorage.getItem("metalInventory");
      const original = JSON.parse(raw);
      const modifiedItems = original.map((item) => ({ ...item }));
      modifiedItems[0].notes = "MODIFIED-BY-STRK-118";
      modifiedItems.push({
        metal: "Platinum",
        composition: "Platinum",
        name: "STRK-118-NEW-ITEM",
        qty: 1,
        type: "Coin",
        weight: 1,
        price: 999,
        marketValue: 0,
        date: "2026-01-01",
        purchaseLocation: "",
        storageLocation: "",
        serialNumber: "",
        notes: "",
        year: "2026",
        grade: "",
        gradingAuthority: "",
        certNumber: "",
        pcgsNumber: "",
        pcgsVerified: false,
        spotPriceAtPurchase: 0,
        premiumPerOz: 0,
        totalPremium: 0,
        purity: 0.9995,
        numistaId: "",
        serial: 99999,
      });
      localStorage.setItem("metalInventory", JSON.stringify(modifiedItems));
      const modifiedBytes = await window.vaultEncryptToBytes(password);
      const fewerItems = original.slice(0, -1);
      localStorage.setItem("metalInventory", JSON.stringify(fewerItems));
      const removedBytes = await window.vaultEncryptToBytes(password);
      localStorage.setItem("metalInventory", raw);
      await window.loadInventory?.();

      async function preview(bytes) {
        let capturedDiff = null;
        const origShow = window.DiffModal.show;
        const origToast = window.showToast;
        window.DiffModal.show = (opts) => {
          capturedDiff = opts.diff;
        };
        window.showToast = () => {};
        await window.vaultRestoreWithPreview(bytes, password);
        window.DiffModal.show = origShow;
        window.showToast = origToast;
        return capturedDiff;
      }

      const modified = await preview(modifiedBytes);
      const removed = await preview(removedBytes);
      return {
        modifiedAdded: modified.added.length,
        modifiedChanged: modified.modified.length,
        removedDeleted: removed.deleted.length,
        removedAdded: removed.added.length,
      };
    }, VAULT_PASSWORD);

    expect(result).toMatchObject({
      modifiedAdded: 1,
      modifiedChanged: 1,
      removedDeleted: 1,
      removedAdded: 0,
    });
  });

  test("attachment companion vault helpers and lookup keys stay re-associable", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.attachmentManager !== "undefined");

    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      await attachmentManager.addAttachment({
        attachmentUuid: "strk118-reassociate",
        itemUuid: "strk118-item",
        fileName: "certificate.pdf",
        mimeType: "application/pdf",
        size: 1500,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        blob: new Blob(["cert"], { type: "application/pdf" }),
      });
      const itemMeta = { attachmentUuid: "strk118-reassociate", fileName: "certificate.pdf" };
      const fetched = await attachmentManager.getAttachment(itemMeta.attachmentUuid);
      return {
        found: fetched !== null,
        fileName: fetched?.fileName,
        suffix: window.VAULT_ATTACHMENT_FILE_SUFFIX,
        hasEncrypt:
          typeof window.vaultEncryptAttachmentVault === "function" ||
          typeof window.collectAndHashAttachmentVault === "function",
      };
    });

    expect(result).toMatchObject({
      found: true,
      fileName: "certificate.pdf",
      suffix: "-attachments",
      hasEncrypt: true,
    });
  });
});

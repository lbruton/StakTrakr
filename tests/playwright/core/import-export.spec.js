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

const TRADE_SOURCE_ITEM = {
  uuid: "strk123-trade-source",
  serial: 1231,
  metal: "Silver",
  composition: "Silver",
  name: "STRK-123 Trade Source",
  qty: 1,
  type: "Round",
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 30,
  date: "2026-01-01",
  disposition: {
    type: "traded",
    date: "2026-01-15",
    amount: 65,
    tradedForUuids: ["strk123-trade-received"],
    tradeValues: {
      "strk123-trade-received": { meltValue: 59.94, spotPrice: 30, isCustom: false },
    },
  },
};

const TRADE_RECEIVED_ITEM = {
  uuid: "strk123-trade-received",
  serial: 1232,
  metal: "Silver",
  composition: "Silver",
  name: "STRK-123 Trade Received",
  qty: 2,
  type: "Round",
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 0,
  date: "2026-01-15",
  tradedFromUuid: "strk123-trade-source",
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

  test("trade-link fields round-trip through standalone CSV and ZIP JSON backup", async ({
    page,
  }) => {
    await page.addInitScript(
      ({ source, received }) => {
        localStorage.setItem("metalInventory", JSON.stringify([source, received]));
        localStorage.setItem("itemTags", JSON.stringify({}));
        document.addEventListener(
          "DOMContentLoaded",
          () => {
            if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
          },
          { once: true }
        );
      },
      { source: TRADE_SOURCE_ITEM, received: TRADE_RECEIVED_ITEM }
    );
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.exportInventoryCSV === "function" &&
        typeof window.importCsvFromText === "function" &&
        typeof window.createBackupZip === "function"
    );

    const result = await page.evaluate(async () => {
      const csv = window.exportInventoryCSV();
      const imported = window.importCsvFromText(csv);
      const blob = await window.createBackupZip();
      const zip = await window.JSZip.loadAsync(await blob.arrayBuffer());
      const backup = JSON.parse(await zip.file("inventory_data.json").async("string"));
      const csvHeaders = window.Papa.parse(
        csv
          .split("\n")
          .filter((line) => !line.startsWith("# exportOrigin:"))
          .join("\n"),
        { header: true, skipEmptyLines: true }
      ).meta.fields;
      return {
        csvHeaders,
        csvSource: imported.find((item) => item.uuid === "strk123-trade-source"),
        csvReceived: imported.find((item) => item.uuid === "strk123-trade-received"),
        backupSource: backup.inventory.find((item) => item.uuid === "strk123-trade-source"),
        backupReceived: backup.inventory.find((item) => item.uuid === "strk123-trade-received"),
      };
    });

    expect(result.csvHeaders).toContain("Traded For UUIDs");
    expect(result.csvHeaders).toContain("Traded From UUID");
    expect(result.csvSource.disposition.tradedForUuids).toEqual(["strk123-trade-received"]);
    expect(result.csvSource.disposition.tradeValues).toBeUndefined();
    expect(result.csvReceived.tradedFromUuid).toBe("strk123-trade-source");
    expect(result.backupSource.disposition.tradeValues["strk123-trade-received"]).toMatchObject({
      spotPrice: 30,
      isCustom: false,
    });
    expect(result.backupReceived.tradedFromUuid).toBe("strk123-trade-source");
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

  test("encrypted image vault round-trips pattern rule images through wipe and restore", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    // Suppress demo seed pattern rules so the patternImages store holds only
    // what this test caches (seed-images.js gates on seedImagesVer).
    await page.addInitScript(() => {
      localStorage.setItem("seedImagesVer", "1");
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.imageCache !== "undefined" &&
        typeof window.collectAndHashImageVault === "function" &&
        typeof window.vaultEncryptImageVault === "function" &&
        typeof window.vaultDecryptAndRestoreImages === "function"
    );

    const RULE_ID = "custom-strk185-roundtrip";
    const RULE = {
      id: RULE_ID,
      pattern: "\\bGeneric Silver Round\\b",
      replacement: "Generic Silver Round",
      numistaId: null,
      seedImageId: RULE_ID,
    };

    // Phase 1: seed a pattern rule + images, export the encrypted image vault.
    const exported = await page.evaluate(
      async ({ password, rule }) => {
        localStorage.setItem("numistaLookupRules", JSON.stringify([rule]));
        await window.imageCache.init();
        await window.imageCache.clearAll();
        const cached = await window.imageCache.cachePatternImage(
          rule.id,
          new Blob(["strk185-obverse-bytes"], { type: "image/png" }),
          new Blob(["strk185-reverse-bytes"], { type: "image/png" })
        );
        const collected = await window.collectAndHashImageVault();
        const bytes = await window.vaultEncryptImageVault(password, collected.payload);
        return {
          cached,
          exportedPatternCount: collected.patternImageCount,
          exportedTotalCount: collected.imageCount,
          payloadPatternRecords: (collected.payload.patternRecords || []).length,
          vaultBytes: Array.from(bytes),
        };
      },
      { password: VAULT_PASSWORD, rule: RULE }
    );

    // Phase 2: wipe storage from a neutral same-origin page where the app is
    // not running — deleting the IDB database from the live app deadlocks
    // against its open connections. This mirrors the STRK-185 report's
    // Windows-update wipe: the database itself is gone, not just emptied.
    await page.goto("/strk185-neutral-404", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      localStorage.clear();
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase("StakTrakrImages");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    });

    // Phase 3: boot the app fresh (schema gets recreated), restore, verify.
    // The rule definition itself returns via the data vault (numistaLookupRules
    // is in SYNC_SCOPE_KEYS) — simulate that half of the restore directly.
    await page.addInitScript((rule) => {
      localStorage.setItem("numistaLookupRules", JSON.stringify([rule]));
      localStorage.setItem("seedImagesVer", "1");
    }, RULE);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.imageCache !== "undefined" &&
        typeof window.vaultDecryptAndRestoreImages === "function"
    );

    const result = await page.evaluate(
      async ({ password, ruleId, vaultBytes }) => {
        const wipedRecord = await window.imageCache.getPatternImage(ruleId);
        const restoredCount = await window.vaultDecryptAndRestoreImages(
          new Uint8Array(vaultBytes),
          password
        );
        const record = await window.imageCache.getPatternImage(ruleId);
        const url = await window.imageCache.getPatternImageUrl(ruleId, "obverse");
        const rules = JSON.parse(localStorage.getItem("numistaLookupRules") || "[]");
        return {
          wipedRecordGone: !wipedRecord,
          restoredCount,
          obverseText: record && record.obverse ? await record.obverse.text() : null,
          reverseText: record && record.reverse ? await record.reverse.text() : null,
          urlResolved: typeof url === "string" && url.startsWith("blob:"),
          ruleSurvived: rules.some((r) => r.id === ruleId && r.seedImageId === ruleId),
        };
      },
      { password: VAULT_PASSWORD, ruleId: RULE_ID, vaultBytes: exported.vaultBytes }
    );

    expect(exported.cached).toBe(true);
    // Pattern-only export must proceed (no user images cached at all).
    expect(exported.exportedPatternCount).toBe(1);
    expect(exported.exportedTotalCount).toBe(1);
    expect(exported.payloadPatternRecords).toBe(1);
    expect(result.wipedRecordGone).toBe(true);
    expect(result.restoredCount).toBe(1);
    expect(result.obverseText).toBe("strk185-obverse-bytes");
    expect(result.reverseText).toBe("strk185-reverse-bytes");
    expect(result.urlResolved).toBe(true);
    expect(result.ruleSurvived).toBe(true);
  });

  test("image vault hash stays legacy-stable and legacy payloads restore without pattern records", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    await page.addInitScript(() => {
      localStorage.setItem("seedImagesVer", "1");
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.imageCache !== "undefined" &&
        typeof window.collectAndHashImageVault === "function" &&
        typeof window.vaultDecryptAndRestoreImages === "function"
    );

    const result = await page.evaluate(async (password) => {
      // Independent copy of vault.js simpleHash — asserts the exact legacy formula.
      const legacySimpleHash = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return "sh:" + (hash >>> 0).toString(16);
      };

      await window.imageCache.init();
      await window.imageCache.clearAll();
      await window.imageCache.importUserImageRecord({
        uuid: "strk185-user-uuid",
        obverse: new Blob(["strk185-user-obverse"], { type: "image/png" }),
        reverse: null,
        cachedAt: 1717286400000,
        size: 19,
      });

      const before = await window.collectAndHashImageVault();
      // Pre-STRK-185 hash input: user-image parts only, no "p:" entries.
      const legacyHash = legacySimpleHash(
        JSON.stringify(
          before.payload.records.map(
            (e) => e.uuid + ":" + e.size + ":" + (e.obverse ? e.obverse.slice(0, 32) : "")
          )
        )
      );

      await window.imageCache.cachePatternImage(
        "strk185-hash-rule",
        new Blob(["strk185-pattern-obverse"], { type: "image/png" }),
        null
      );
      const after = await window.collectAndHashImageVault();

      // Legacy payload (no patternRecords key at all) must restore cleanly.
      const legacyPayload = {
        _meta: {
          appVersion: "3.35.15",
          exportTimestamp: "2026-01-01T00:00:00.000Z",
          imageCount: before.payload.records.length,
        },
        records: before.payload.records,
      };
      const legacyBytes = await window.vaultEncryptImageVault(password, legacyPayload);
      await window.imageCache.clearAll();
      const legacyCount = await window.vaultDecryptAndRestoreImages(legacyBytes, password);
      const restoredUsers = await window.imageCache.exportAllUserImages();
      const restoredPatterns = await window.imageCache.exportAllPatternImages();

      return {
        zeroPatternHashMatchesLegacy: before.hash === legacyHash,
        beforePatternCount: before.patternImageCount,
        hashChangedWithPattern: after.hash !== before.hash,
        afterPatternCount: after.patternImageCount,
        afterTotalCount: after.imageCount,
        legacyCount,
        restoredUserCount: restoredUsers.length,
        restoredPatternCount: restoredPatterns.length,
      };
    }, VAULT_PASSWORD);

    expect(result.zeroPatternHashMatchesLegacy).toBe(true);
    expect(result.beforePatternCount).toBe(0);
    expect(result.hashChangedWithPattern).toBe(true);
    expect(result.afterPatternCount).toBe(1);
    expect(result.afterTotalCount).toBe(2);
    expect(result.legacyCount).toBe(1);
    expect(result.restoredUserCount).toBe(1);
    expect(result.restoredPatternCount).toBe(0);
  });
});

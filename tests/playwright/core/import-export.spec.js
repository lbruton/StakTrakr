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

const STRK198_UUIDLESS_CSV = [
  "Date,Metal,Type,Name,Year,Qty,Weight(oz),Weight Unit,Purity,Purchase Price,Tags,removedTags",
  "2026-06-16,Silver,Coin,STRK-198 UUID-less Tag Eagle,2024,1,1,oz,0.999,30,Bullion; Test Tag,Eagle",
].join("\n");

/**
 * Resets all import-related localStorage and in-memory state to an empty baseline.
 * @param {import('@playwright/test').Page} page - Playwright page instance.
 * @returns {Promise<void>}
 */
async function resetEmptyImportState(page) {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("metalInventory", JSON.stringify([]));
    localStorage.setItem("itemTags", JSON.stringify({}));
    localStorage.setItem("itemRemovedTags", JSON.stringify({}));
    if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
    window.inventory = [];
    window.itemTags = {};
    if (typeof window.renderTable === "function") window.renderTable();
  });
}

/**
 * Navigates to the app and waits until all import-export globals are ready.
 * @param {import('@playwright/test').Page} page - Playwright page instance.
 * @returns {Promise<void>}
 */
async function gotoImportExportApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.importCsv === "function" &&
      typeof window.getItemTags === "function" &&
      typeof window.loadDataSync === "function" &&
      typeof window.restoreVaultData === "function" &&
      window.DiffModal &&
      Array.isArray(window.inventory)
  );
}

/**
 * Captures the current STRK-198 tag state from the page (inventory item, itemTags, removedTags).
 * @param {import('@playwright/test').Page} page - Playwright page instance.
 * @returns {Promise<{item: object, persistedUuid: string, itemTags: object, removedTags: object}>}
 */
async function captureStrk198TagState(page) {
  return page.evaluate(() => {
    const item = window.inventory[0] || {};
    const itemTags = JSON.parse(localStorage.getItem("itemTags") || "{}");
    const removedTags = JSON.parse(localStorage.getItem("itemRemovedTags") || "{}");
    const persisted = window.loadDataSync("metalInventory", []);
    return {
      item: {
        uuid: item.uuid || "",
        serial: item.serial,
        name: item.name || "",
        tags: item.uuid ? window.getItemTags(item.uuid) : [],
      },
      persistedUuid: persisted[0] ? persisted[0].uuid || "" : "",
      itemTags,
      removedTags,
    };
  });
}

/**
 * Imports the STRK-198 UUID-less CSV fixture into the app and returns the resulting tag state.
 * @param {import('@playwright/test').Page} page - Playwright page instance.
 * @param {{override: boolean}} options - When override is true, uses the CSV override path; otherwise stubs DiffModal.
 * @returns {Promise<{item: object, persistedUuid: string, itemTags: object, removedTags: object}>}
 */
async function importStrk198Csv(page, { override }) {
  await page.evaluate(
    ({ csvText, shouldOverride }) => {
      const file = new File([csvText], "strk-198-uuidless-tags.csv", { type: "text/csv" });
      if (!shouldOverride) {
        const originalShow = window.DiffModal.show;
        window.DiffModal.show = (options) => {
          try {
            const selected = (options.diff.added || []).map((item) => ({ type: "add", item }));
            options.onApply(selected);
          } finally {
            window.DiffModal.show = originalShow;
          }
        };
      }
      window.importCsv(file, shouldOverride);
    },
    { csvText: STRK198_UUIDLESS_CSV, shouldOverride: override }
  );
  await page.waitForFunction(
    () =>
      window.inventory.length === 1 &&
      window.inventory[0].name === "STRK-198 UUID-less Tag Eagle" &&
      Boolean(window.inventory[0].uuid)
  );
  return captureStrk198TagState(page);
}

/**
 * Waits for the page to be ready after a reload with the STRK-198 fixture item loaded.
 * @param {import('@playwright/test').Page} page - Playwright page instance.
 * @returns {Promise<void>}
 */
async function waitForStrk198Reload(page) {
  await page.waitForFunction(
    () =>
      typeof window.getItemTags === "function" &&
      window.inventory.length === 1 &&
      window.inventory[0].name === "STRK-198 UUID-less Tag Eagle" &&
      Boolean(window.inventory[0].uuid)
  );
}

/**
 * Asserts that the STRK-198 tag state is correct — UUID stamped, tags applied, removedTags written, no empty-key collision.
 * @param {{item: object, persistedUuid: string, itemTags: object, removedTags: object}} state - Captured tag state.
 * @returns {void}
 */
function expectStrk198Tags(state) {
  expect(state.item.uuid).toBeTruthy();
  expect(state.item.uuid).not.toBe("");
  expect(state.persistedUuid).toBe(state.item.uuid);
  expect(state.item.tags).toEqual(["Bullion", "Test Tag"]);
  expect(state.itemTags[state.item.uuid]).toEqual(["Bullion", "Test Tag"]);
  expect(state.removedTags[state.item.uuid]).toEqual(["Eagle"]);
  expect(state.removedTags[""]).toBeUndefined();
}

/**
 * Collects vault data, clears localStorage, restores via restoreVaultData, and returns the resulting tag state.
 * @param {import('@playwright/test').Page} page - Playwright page instance.
 * @returns {Promise<{item: object, persistedUuid: string, itemTags: object, removedTags: object}>}
 */
async function roundTripStrk198VaultData(page) {
  return page.evaluate(async () => {
    const payload = window.collectVaultData("full");
    localStorage.clear();
    await window.restoreVaultData(payload);
    const item = window.inventory[0] || {};
    return {
      item: {
        uuid: item.uuid || "",
        serial: item.serial,
        name: item.name || "",
        tags: item.uuid ? window.getItemTags(item.uuid) : [],
      },
      persistedUuid: window.loadDataSync("metalInventory", [])[0]?.uuid || "",
      itemTags: JSON.parse(localStorage.getItem("itemTags") || "{}"),
      removedTags: JSON.parse(localStorage.getItem("itemRemovedTags") || "{}"),
    };
  });
}

test.describe("core/import-export", () => {
  test("UUID-less CSV merge import stamps identity before tag stores and vault restore", async ({
    page,
  }) => {
    await gotoImportExportApp(page);
    await resetEmptyImportState(page);

    const imported = await importStrk198Csv(page, { override: false });
    expectStrk198Tags(imported);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForStrk198Reload(page);
    expectStrk198Tags(await captureStrk198TagState(page));

    expectStrk198Tags(await roundTripStrk198VaultData(page));
  });

  test("UUID-less CSV override import stamps identity before tag stores", async ({ page }) => {
    await gotoImportExportApp(page);
    await resetEmptyImportState(page);

    const imported = await importStrk198Csv(page, { override: true });
    expectStrk198Tags(imported);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForStrk198Reload(page);
    expectStrk198Tags(await captureStrk198TagState(page));
  });

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
      // STRK-200: restoreImageVaultData now skips records whose item UUID isn't in
      // the inventory (orphan guard). The real .stvault flow commits inventory before
      // images restore, so admit this record's item to mirror that precondition.
      window.inventory = [
        ...(Array.isArray(window.inventory) ? window.inventory : []),
        { uuid: "strk185-user-uuid" },
      ];
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

  // STRK-170 cohort 1.3 characterization — the core suite otherwise never exercises the
  // restoreBackupZip -> applyAncillaryData path (only an archived legacy spec calls it).
  // This pins applyAncillaryData's observable ancillary restore (per-metal spot prices,
  // retail prices, catalog mappings, item price history) so the cohort-1.3 decomposition of
  // applyAncillaryData (ccn68) cannot silently drift. Stub pattern mirrors the archived
  // stak-443 restore test: auto-accept the diff modal, signal completion via the success toast.
  test("ZIP restore applies ancillary spot/retail/catalog/history data (applyAncillaryData)", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.restoreBackupZip === "function");

    const { histTs } = await page.evaluate(async () => {
      // Use the page clock so the history entry survives applyItemPriceRetention's age cutoff.
      const histTs = Date.now();
      // Auto-accept the diff modal and flip a flag when the success toast fires.
      window.__zipRestoreComplete = false;
      const originalShowToast = window.showToast;
      window.showToast = function (message, level) {
        if (typeof originalShowToast === "function") originalShowToast(message, level);
        if (String(message || "").includes("ZIP backup restored successfully")) {
          window.__zipRestoreComplete = true;
        }
      };
      window.showImportDiffReview = function (_items, _meta, options, onDone) {
        const changes = options?.settingsDiff?.changed || [];
        for (const change of changes) {
          localStorage.setItem(
            change.key,
            typeof change.remoteVal === "string"
              ? change.remoteVal
              : JSON.stringify(change.remoteVal)
          );
        }
        onDone({ added: 0, modified: 0, deleted: 0 });
      };

      // Build a backup ZIP carrying the ancillary files applyAncillaryData reads.
      const zip = new window.JSZip();
      zip.file(
        "inventory_data.json",
        JSON.stringify({ version: "test", exportDate: new Date().toISOString(), inventory: [] })
      );
      zip.file(
        "settings.json",
        JSON.stringify({
          version: "test",
          exportDate: new Date().toISOString(),
          exportOrigin: window.location.origin,
          spotPrices: { gold: 2500.5, silver: 30.25, platinum: 950, palladium: 1100 },
          catalogMappings: { "strk170-char-numista": "strk170-char-uuid" },
        })
      );
      zip.file(
        "retail_prices.json",
        JSON.stringify({ "american-silver-eagle": { price: 42.5, currency: "USD" } })
      );
      zip.file(
        "item_price_history.json",
        JSON.stringify({
          version: "test",
          exportDate: new Date().toISOString(),
          history: { "strk170-char-uuid": [{ ts: histTs, price: 41.1 }] },
        })
      );

      const file = new File([await zip.generateAsync({ type: "blob" })], "char-restore.zip", {
        type: "application/zip",
      });
      await window.restoreBackupZip(file);
      return { histTs };
    });

    await page.waitForFunction(() => window.__zipRestoreComplete === true);

    // NOTE: per-metal spot prices restored from settings.spotPrices are intentionally
    // NOT asserted — applyAncillaryData ends with fetchSpotPrice()/syncManualSpotStorage(),
    // which re-derive spot state and overwrite the restored values (transient effect). The
    // catalog assertion still proves the spot+catalog restore phase executed. Retail prices,
    // catalog mappings, and item price history are stable (untouched by the trailing steps).
    const restored = await page.evaluate(() => ({
      retail: window.loadDataSync(window.RETAIL_PRICES_KEY, null),
      catalog: window.catalogManager.exportMappings(),
      history: window.loadDataSync("item-price-history", {})["strk170-char-uuid"] || null,
    }));

    expect(restored.retail).toEqual({ "american-silver-eagle": { price: 42.5, currency: "USD" } });
    expect(restored.catalog).toMatchObject({ "strk170-char-numista": "strk170-char-uuid" });
    expect(restored.history).toEqual([{ ts: histTs, price: 41.1 }]);
  });

  // STRK-202: the ZIP backup now carries numistaLookupRules, so a restore brings
  // the rules back alongside their pattern images. Before this, settings.json
  // omitted the rules — a restore reinstated the images but left no rule pointing
  // at them, orphaning every one.
  test("backup ZIP round-trips custom rules so restored pattern images are not orphaned", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    // Suppress demo seed rules/images so patternImages holds only our fixture.
    await page.addInitScript(() => localStorage.setItem("seedImagesVer", "1"));
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.createBackupZip === "function" &&
        typeof window.restoreBackupZip === "function" &&
        typeof window.imageCache !== "undefined" &&
        window.NumistaLookup &&
        typeof window.JSZip !== "undefined"
    );

    const RULE_ID = "custom-strk202-roundtrip";
    const RULE = {
      id: RULE_ID,
      pattern: "\\bMorgan Dollar\\b",
      replacement: "Morgan Dollar",
      numistaId: null,
      seedImageId: RULE_ID,
    };

    // Phase 1: seed a rule + its pattern image, export a backup ZIP, and confirm
    // the rule rides in settings.json (the export half of the fix).
    const exported = await page.evaluate(
      async ({ rule }) => {
        localStorage.setItem("numistaLookupRules", JSON.stringify([rule]));
        window.NumistaLookup.loadCustomRules();
        await window.imageCache.init();
        await window.imageCache.clearAll();
        await window.imageCache.cachePatternImage(
          rule.seedImageId,
          new Blob(["strk202-obverse"], { type: "image/png" }),
          new Blob(["strk202-reverse"], { type: "image/png" })
        );
        const blob = await window.createBackupZip();
        const buf = await blob.arrayBuffer();
        const zip = await window.JSZip.loadAsync(buf);
        const settings = JSON.parse(await zip.file("settings.json").async("string"));
        return {
          settingsRules: settings.numistaLookupRules,
          zipBytes: Array.from(new Uint8Array(buf)),
        };
      },
      { rule: RULE }
    );

    expect(typeof exported.settingsRules).toBe("string");
    expect(JSON.parse(exported.settingsRules)).toEqual([RULE]);

    // Phase 2: simulate the post-restore-without-rules state — drop the rule but
    // keep its image in IndexedDB, so the image is now orphaned (the bug).
    const orphanedBefore = await page.evaluate(async () => {
      localStorage.removeItem("numistaLookupRules");
      window.NumistaLookup.importRules([], false); // empty the in-memory rules
      const records = await window.imageCache.exportAllPatternImages();
      const referenced = new Set(
        window.NumistaLookup.getCustomRules()
          .map((r) => r.seedImageId)
          .filter(Boolean)
      );
      return records.filter((rec) => !referenced.has(rec.ruleId)).map((rec) => rec.ruleId);
    });
    expect(orphanedBefore).toContain(RULE_ID);

    // Phase 3: restore the ZIP. Stub the diff modal to auto-complete so
    // applyAncillaryData (which runs _restoreNumistaRules) fires.
    await page.evaluate(async (zipBytes) => {
      window.__zipRestoreComplete = false;
      const origToast = window.showToast;
      window.showToast = (msg, level) => {
        if (typeof origToast === "function") origToast(msg, level);
        if (String(msg || "").includes("ZIP backup restored successfully")) {
          window.__zipRestoreComplete = true;
        }
      };
      window.showImportDiffReview = (_items, _meta, _opts, onDone) =>
        onDone({ added: 0, modified: 0, deleted: 0 });
      const file = new File([new Uint8Array(zipBytes)], "strk202-restore.zip", {
        type: "application/zip",
      });
      await window.restoreBackupZip(file);
    }, exported.zipBytes);
    await page.waitForFunction(() => window.__zipRestoreComplete === true);

    // Phase 4: the rule is back (with its seedImageId) and nothing is orphaned —
    // the restored image re-binds to the restored rule.
    const after = await page.evaluate(async (ruleId) => {
      const rules = window.NumistaLookup.getCustomRules();
      const records = await window.imageCache.exportAllPatternImages();
      const referenced = new Set(rules.map((r) => r.seedImageId).filter(Boolean));
      const url = await window.imageCache.getPatternImageUrl(ruleId, "obverse");
      return {
        ruleRestored: rules.some((r) => r.id === ruleId && r.seedImageId === ruleId),
        orphanCount: records.filter((rec) => !referenced.has(rec.ruleId)).length,
        imageResolves: typeof url === "string" && url.startsWith("blob:"),
      };
    }, RULE_ID);

    expect(after.ruleRestored).toBe(true);
    expect(after.orphanCount).toBe(0);
    expect(after.imageResolves).toBe(true);
  });

  // STRK-202: showImportDiffReview early-returns when inventory + mapped settings
  // match and there is no settings diff. Since numistaLookupRules is intentionally
  // NOT in the flat settings diff, a rules/images-only restore would otherwise skip
  // the ancillary path entirely and leave the images orphaned. restoreBackupZip
  // passes alwaysApplyAncillary so the ancillary restore runs anyway. Uses the REAL
  // showImportDiffReview (no stub) to exercise the no-change branch.
  test("ZIP restore applies rules + images even when inventory is unchanged", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("seedImagesVer", "1"));
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.restoreBackupZip === "function" &&
        typeof window.imageCache !== "undefined" &&
        window.NumistaLookup &&
        typeof window.JSZip !== "undefined" &&
        typeof window.DiffEngine !== "undefined" &&
        typeof window.DiffModal !== "undefined"
    );

    const RULE_ID = "custom-strk202-nochange";
    const RULE = {
      id: RULE_ID,
      pattern: "\\bPeace Dollar\\b",
      replacement: "Peace Dollar",
      numistaId: null,
      seedImageId: RULE_ID,
    };

    await page.evaluate(
      async ({ rule }) => {
        // Empty inventory + no rules locally → a restore otherwise sees "no changes".
        localStorage.setItem("metalInventory", JSON.stringify([]));
        localStorage.removeItem("numistaLookupRules");
        window.inventory = [];
        window.NumistaLookup.importRules([], false);
        await window.imageCache.init();
        await window.imageCache.clearAll();

        // Signal completion via the success toast; do NOT stub showImportDiffReview —
        // the real no-change branch must run.
        window.__nochangeDone = false;
        const origToast = window.showToast;
        window.showToast = (msg, level) => {
          if (typeof origToast === "function") origToast(msg, level);
          if (String(msg || "").includes("ZIP backup restored successfully")) {
            window.__nochangeDone = true;
          }
        };

        const zip = new window.JSZip();
        zip.file(
          "inventory_data.json",
          JSON.stringify({ version: "test", exportDate: new Date().toISOString(), inventory: [] })
        );
        // settings.json carries ONLY the rules key — nothing in the flat settings
        // allowlist — so settingsDiff stays null and the no-change branch is hit.
        zip.file(
          "settings.json",
          JSON.stringify({
            version: "test",
            exportDate: new Date().toISOString(),
            exportOrigin: window.location.origin,
            numistaLookupRules: JSON.stringify([rule]),
          })
        );
        zip
          .folder("pattern_images")
          .file(
            `${rule.seedImageId}_obverse.jpg`,
            new Blob(["nochange-obv"], { type: "image/jpeg" })
          );

        const file = new File([await zip.generateAsync({ type: "blob" })], "nochange.zip", {
          type: "application/zip",
        });
        await window.restoreBackupZip(file);
      },
      { rule: RULE }
    );

    await page.waitForFunction(() => window.__nochangeDone === true);

    const after = await page.evaluate(async (ruleId) => {
      const rules = window.NumistaLookup.getCustomRules();
      const rec = await window.imageCache.getPatternImage(ruleId);
      return {
        ruleRestored: rules.some((r) => r.id === ruleId && r.seedImageId === ruleId),
        imageRestored: Boolean(rec && rec.obverse),
      };
    }, RULE_ID);

    expect(after.ruleRestored).toBe(true);
    expect(after.imageRestored).toBe(true);
  });

  // STRK-200: _restoreUserImages now guards every import against the committed
  // inventory (mirroring _restoreAttachments). A backup whose user_image_manifest
  // lists a photo for an item that was de-duplicated away — so its UUID is absent
  // from the restored inventory — must NOT import that photo, or it lingers in
  // IndexedDB forever as an un-editable orphan row in Settings (field-reported).
  test("ZIP user-image restore skips photos whose item UUID is not in the inventory (STRK-200)", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("seedImagesVer", "1"));
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.restoreBackupZip === "function" &&
        typeof window.imageCache !== "undefined" &&
        typeof window.JSZip !== "undefined" &&
        typeof window.DiffEngine !== "undefined"
    );

    const KEEP = "strk200-zip-keep";
    const ORPHAN = "strk200-zip-orphan";

    await page.evaluate(
      async ({ keep, orphan }) => {
        // Committed inventory holds ONLY the kept item; the orphan's item is gone.
        const keepItem = {
          uuid: keep,
          serial: 2001,
          name: "STRK-200 Keep",
          metal: "Silver",
          composition: "Silver",
          qty: 1,
          type: "Coin",
          weight: 1,
          weightUnit: "oz",
          purity: 0.999,
          price: 30,
          date: "2026-06-17",
        };
        localStorage.setItem("metalInventory", JSON.stringify([keepItem]));
        window.inventory = [keepItem];
        await window.imageCache.init();
        await window.imageCache.clearAll();

        window.__strk200ZipDone = false;
        const origToast = window.showToast;
        window.showToast = (msg, level) => {
          if (typeof origToast === "function") origToast(msg, level);
          if (String(msg || "").includes("ZIP backup restored successfully")) {
            window.__strk200ZipDone = true;
          }
        };
        // Auto-accept the diff so applyAncillaryData (→ _restoreUserImages) fires.
        window.showImportDiffReview = (_items, _meta, _opts, onDone) =>
          onDone({ added: 0, modified: 0, deleted: 0 });

        const zip = new window.JSZip();
        zip.file(
          "inventory_data.json",
          JSON.stringify({
            version: "test",
            exportDate: new Date().toISOString(),
            inventory: [keepItem],
          })
        );
        zip.file(
          "settings.json",
          JSON.stringify({
            version: "test",
            exportDate: new Date().toISOString(),
            exportOrigin: window.location.origin,
          })
        );
        const imgFolder = zip.folder("user_images");
        imgFolder.file(`${keep}_obverse.png`, new Blob(["keep-obv"], { type: "image/png" }));
        imgFolder.file(`${orphan}_obverse.png`, new Blob(["orphan-obv"], { type: "image/png" }));
        zip.file(
          "user_image_manifest.json",
          JSON.stringify({
            entries: [
              {
                uuid: keep,
                obverseFile: `user_images/${keep}_obverse.png`,
                reverseFile: null,
                cachedAt: Date.now(),
                size: 8,
              },
              {
                uuid: orphan,
                obverseFile: `user_images/${orphan}_obverse.png`,
                reverseFile: null,
                cachedAt: Date.now(),
                size: 10,
              },
            ],
          })
        );

        const file = new File([await zip.generateAsync({ type: "blob" })], "strk200.zip", {
          type: "application/zip",
        });
        await window.restoreBackupZip(file);
      },
      { keep: KEEP, orphan: ORPHAN }
    );

    await page.waitForFunction(() => window.__strk200ZipDone === true);

    const stored = await page.evaluate(async () => {
      const recs = await window.imageCache.exportAllUserImages();
      return recs.map((r) => r.uuid);
    });
    expect(stored).toContain(KEEP); // accepted item's photo restored
    expect(stored).not.toContain(ORPHAN); // orphan photo skipped — no IndexedDB bloat
  });

  // STRK-200: restoreImageVaultData (the .stvault companion + cloud-sync image
  // sink) gets the same guard. A decrypted payload can carry photo records for
  // items no longer in the inventory; importing them is what produced the field
  // orphans. The guard skips them while still importing live records.
  test(".stvault image restore skips photos whose item UUID is not in the inventory (STRK-200)", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("seedImagesVer", "1"));
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.restoreImageVaultData === "function" &&
        typeof window.imageCache !== "undefined"
    );

    const KEEP = "strk200-vault-keep";
    const ORPHAN = "strk200-vault-orphan";

    const stored = await page.evaluate(
      async ({ keep, orphan }) => {
        window.inventory = [
          {
            uuid: keep,
            serial: 2002,
            name: "STRK-200 Vault Keep",
            metal: "Silver",
            composition: "Silver",
            qty: 1,
            type: "Coin",
            weight: 1,
            weightUnit: "oz",
            purity: 0.999,
            price: 30,
            date: "2026-06-17",
          },
        ];
        await window.imageCache.init();
        await window.imageCache.clearAll();
        const b64 = btoa("strk200-img");
        const imported = await window.restoreImageVaultData({
          records: [
            { uuid: keep, obverse: b64, obverseType: "image/png", cachedAt: Date.now(), size: 11 },
            {
              uuid: orphan,
              obverse: b64,
              obverseType: "image/png",
              cachedAt: Date.now(),
              size: 11,
            },
          ],
        });
        const recs = await window.imageCache.exportAllUserImages();
        return { uuids: recs.map((r) => r.uuid), imported };
      },
      { keep: KEEP, orphan: ORPHAN }
    );

    expect(stored.uuids).toContain(KEEP);
    expect(stored.uuids).not.toContain(ORPHAN);
    expect(stored.imported).toBe(1); // only the live record counted as imported
  });
});

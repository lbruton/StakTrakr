// Collections data paths (STRK-371 / STRK-370, epic STRK-254).
//
// Collection membership lives on the Collection, never on the Item, so NO item-shaped data
// path carries it for free. This file pins every way a user's Collections leave and re-enter
// the app: the encrypted .stvault, the standalone Collections file, JSON, and CSV. The ZIP
// backup round trip stays in collections.spec.js where it landed with STRK-368.

import { test, expect } from "../helpers/mocks/extended-test.js";
import {
  collectionItem as baseItem,
  seedCollectionsPage,
  reloadCollections,
} from "../helpers/collections-fixtures.js";
import { encryptVaultPayload } from "../helpers/vault-fixtures.js";

const SEED = [
  baseItem("cdp-ase-2022", "2022 American Silver Eagle", "2022", 1),
  baseItem("cdp-ase-2024", "2024 American Silver Eagle BU", "2024", 2),
];

const seedAndGoto = (page, items = SEED) => seedCollectionsPage(page, items);

/**
 * Read one ASE Type 2 slot's primary from the in-memory store.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {string} slotId - Slot identifier.
 * @returns {Promise<string|null>} Primary Item UUID, or null.
 */
const primaryOf = (page, slotId) =>
  page.evaluate((id) => {
    const collection = window.collectionsStore.getState().collections["ase-type2"];
    const link = collection && collection.slots[id];
    return link ? link.primary : null;
  }, slotId);

test.describe("core/collections-data-paths — encrypted vault", () => {
  test("a vault restore refreshes the in-memory store, so the next edit cannot erase the restored Collections", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.waitForFunction(
      () =>
        typeof window.collectVaultData === "function" &&
        typeof window.restoreVaultData === "function"
    );

    // Back up with 2024 filled, then lose the link locally.
    const restored = await page.evaluate(async () => {
      window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024");
      const payload = window.collectVaultData("full");
      window.collectionsStore.unlink("ase-type2", "2024", "cdp-ase-2024");
      await window.restoreVaultData(payload);
      return Object.prototype.hasOwnProperty.call(payload.data, "collectionState");
    });
    expect(restored).toBe(true);

    // The restored link is visible to the running app without a reload...
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");

    // ...and a later mutation saves ON TOP of the restored state, not over it.
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022"));
    await reloadCollections(page);
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
  });

  test("failed vault storage writes restore earlier keys and report the failed key", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await injectCollectionQuota(page);
    const result = await page.evaluate(async () => {
      localStorage.setItem("appTheme", "light");
      let message = "";
      try {
        await window.restoreVaultData({
          data: {
            appTheme: "dark",
            collectionState: JSON.stringify(window.collectionsCore.createEmptyState()),
          },
        });
      } catch (error) {
        message = error.message;
      }
      return { message, theme: localStorage.getItem("appTheme") };
    });
    await clearCollectionQuota(page);
    expect(result.message).toContain("Vault restore failed while writing collectionState");
    expect(result.theme).toBe("light");
  });

  test("a matching .stvault restores missing companion artwork", async ({ page }) => {
    await seedAndGoto(page);
    const art = await page.evaluate(async () => {
      const created = window.collectionsStore.createCustom({
        name: "Vault art",
        slots: [{ label: "First" }],
      });
      const collectionId = created.collection.id;
      const response = await fetch("/tests/playwright/helpers/test-obverse.png");
      const file = new File([await response.blob()], "art.png", { type: "image/png" });
      if (!(await window.collectionsPicker.saveImage(collectionId, null, file)))
        throw new Error("artwork upload failed");
      const imageData = await window.collectAndHashImageVault();
      const password = "vault-art-test-key";
      const images = Array.from(await window.vaultEncryptImageVault(password, imageData.payload));
      const payload = window.collectVaultData("full");
      await window.imageCache.deletePatternImage(`collection--${collectionId}`);
      return { collectionId, images, payload, password };
    });
    const vault = await encryptVaultPayload(page, art.payload, art.password);
    const restored = await page.evaluate(
      async ({ images, password, bytes, collectionId }) => {
        window.setVaultPendingImageFile(new Uint8Array(images));
        await window.vaultRestoreWithPreview(new Uint8Array(bytes), password);
        const url = await window.collectionsPicker.getImageUrl(collectionId);
        if (url) URL.revokeObjectURL(url);
        return !!url;
      },
      { ...art, bytes: vault }
    );
    expect(restored).toBe(true);
  });

  test("a failed sync-snapshot restore keeps the prior storage and alerts the user", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022"));
    await injectCollectionQuota(page);
    const result = await page.evaluate(async () => {
      const priorCollection = localStorage.getItem("collectionState");
      const priorInventory = localStorage.getItem("metalInventory");
      localStorage.setItem("appTheme", "light");
      localStorage.setItem(
        "cloud_sync_override_backup",
        JSON.stringify({
          timestamp: Date.now(),
          itemCount: 2,
          appVersion: "test",
          data: { appTheme: "dark", collectionState: "{}" },
        })
      );
      window.showAppConfirm = async () => true;
      let alertText = "";
      window.showAppAlert = async (message) => {
        alertText = message;
      };
      await window.syncRestoreOverrideBackup();
      return {
        alertText,
        theme: localStorage.getItem("appTheme"),
        collection: localStorage.getItem("collectionState"),
        inventory: localStorage.getItem("metalInventory"),
        priorCollection,
        priorInventory,
      };
    });
    await clearCollectionQuota(page);
    expect(result.alertText).toContain("Restore failed");
    expect(result.theme).toBe("light");
    expect(result.collection).toBe(result.priorCollection);
    expect(result.inventory).toBe(result.priorInventory);
  });
});

/**
 * Click an export button and return the downloaded file's text.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {string} trigger - Name of the window-level export function to call.
 * @returns {Promise<{name: string, text: string}>} Suggested filename and contents.
 */
const captureDownload = async (page, trigger) => {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate((fn) => {
      const target = fn.split(".").reduce((scope, key) => scope[key], window);
      target();
    }, trigger),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString("utf-8") };
};

/**
 * Drop every Collection from storage and memory, as a fresh device would look.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>} When the store is empty.
 */
const wipeCollections = (page) =>
  page.evaluate(() => {
    localStorage.removeItem("collectionState");
    window.collectionsStore.reload();
  });

/**
 * Start a CSV import from an empty persisted inventory and Collection state.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>} When the empty state has loaded.
 */
const resetForCsvImport = async (page) => {
  await page.evaluate(() => {
    localStorage.setItem("metalInventory", "[]");
    localStorage.removeItem("collectionState");
  });
  await reloadCollections(page);
};

/**
 * Run an import with the diff modal auto-accepting every change, and wait for its toast.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {{fn: string, name: string, type: string, text: string, failure?: boolean}} spec - Import to run.
 * @returns {Promise<string>} The "Import complete…" / "No changes…" toast text.
 */
const runImport = (page, spec) =>
  page.evaluate(
    ({ fn, name, type, text, failure }) =>
      new Promise((resolve) => {
        const origToast = window.showToast;
        window.showToast = (msg, level) => {
          if (typeof origToast === "function") origToast(msg, level);
          const message = String(msg || "");
          if (
            (failure && message.startsWith("Import incomplete")) ||
            (!failure && /^Import complete|^No changes detected/.test(message))
          ) {
            window.showToast = origToast;
            resolve(message);
          }
        };
        const origShow = window.DiffModal.show;
        window.DiffModal.show = (config) => {
          window.DiffModal.show = origShow;
          const diff = config.diff;
          const changes = [
            ...diff.added.map((item) => ({ type: "add", item })),
            ...diff.modified.map((mod) => ({ type: "modify", ...mod })),
          ];
          config.onApply(changes);
        };
        window[fn](new File([text], name, { type }), false);
      }),
    spec
  );

/**
 * Run the real CSV import and capture PapaParse's result before item sanitization.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {{fn: string, name: string, type: string, text: string}} spec - CSV import to run.
 * @returns {Promise<{toast: string, parsed: object}>} Import toast and parsed rows.
 */
const runCsvImportCapturingParse = async (page, spec) => {
  await page.evaluate(() => {
    const parse = window.Papa.parse;
    window.Papa.parse = (input, options) => {
      if (!(input instanceof File)) return parse(input, options);
      window.Papa.parse = parse;
      return parse(input, {
        ...options,
        complete: (result) => {
          window.lastCsvImportParse = result;
          options.complete(result);
        },
      });
    };
  });
  const toast = await runImport(page, spec);
  return { toast, parsed: await page.evaluate(() => window.lastCsvImportParse) };
};

test.describe("core/collections-data-paths — standalone Collections file", () => {
  test("Settings offers Export and Import Collections, and the file restores links AND an empty Custom Collection", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const customId = await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024");
      return window.collectionsStore.createCustom({
        name: "Carson City Morgans",
        slots: [{ label: "1881-CC" }],
      }).collection.id;
    });

    await expect(page.locator("#exportCollectionsBtn")).toHaveCount(1);
    await expect(page.locator("#importCollectionsBtn")).toHaveCount(1);

    const file = await captureDownload(page, "collectionsIO.exportFile");
    expect(file.name).toMatch(/^staktrakr_collections_\d{8}\.json$/);
    const payload = JSON.parse(file.text);
    expect(payload.kind).toBe("staktrakr-collections");
    expect(payload.state.collections["ase-type2"].slots["2024"].primary).toBe("cdp-ase-2024");

    await wipeCollections(page);
    expect(await primaryOf(page, "2024")).toBeNull();

    const result = await page.evaluate(
      (text) =>
        window.collectionsIO.importFile(
          new File([text], "collections.json", { type: "application/json" })
        ),
      file.text
    );
    expect(result).toEqual({ ok: true, changed: true });
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
    const custom = await page.evaluate(
      (id) => window.collectionsStore.getState().collections[id]?.name,
      customId
    );
    expect(custom).toBe("Carson City Morgans");
  });

  test("importing a file that is not a Collections export changes nothing and reports why", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024"));

    const result = await page.evaluate(() =>
      window.collectionsIO.importFile(
        new File(['{"items":[]}'], "inventory.json", { type: "application/json" })
      )
    );

    expect(result).toEqual({ ok: false, changed: false, reason: "not-collections-file" });
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
  });
});

test.describe("core/collections-data-paths — JSON export and import", () => {
  test("Export JSON carries the Collections state and Import JSON merges it even when no item changed", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.waitForFunction(
      () => typeof window.exportJson === "function" && typeof window.importJson === "function"
    );
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024"));

    const file = await captureDownload(page, "exportJson");
    const payload = JSON.parse(file.text);
    expect(payload.collectionState.collections["ase-type2"].slots["2024"].primary).toBe(
      "cdp-ase-2024"
    );

    // Same items, no Collections: the item diff is empty, so only the zero-diff branch runs.
    await wipeCollections(page);
    const toast = await runImport(page, {
      fn: "importJson",
      name: "inventory.json",
      type: "application/json",
      text: file.text,
    });

    expect(toast).toBe("Import complete: collections updated");
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
  });
});

test.describe("core/collections-data-paths — CSV export and import", () => {
  test("a real CSV download uses CRLF and re-imports non-final trade and Collections values", async ({
    page,
  }) => {
    await seedAndGoto(page, [{ ...SEED[0], tradedFromUuid: "cdp-ase-2024" }, SEED[1]]);
    await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022");
    });
    const file = await captureDownload(page, "exportCsv");
    expect(file.text).toMatch(/^# exportOrigin: [^\r\n]*\r\n/);
    expect(file.text.replace(/\r\n/g, "")).not.toContain("\n");
    const parsed = await page.evaluate(
      (csv) => window.Papa.parse(csv, { header: true, comments: "#", skipEmptyLines: true }),
      file.text
    );
    expect(parsed.meta.linebreak).toBe("\r\n");
    expect(parsed.meta.fields.at(-1)).toBe("Collections");
    expect(parsed.meta.fields.every((field) => !field.endsWith("\r"))).toBe(true);
    expect(parsed.data[0]["Collections"]).toBe("ase-type2:2022");
    expect(parsed.data[0]["Traded From UUID"]).toBe("cdp-ase-2024");
    expect(parsed.data.flatMap(Object.values).every((value) => !String(value).endsWith("\r"))).toBe(
      true
    );

    await resetForCsvImport(page);
    expect(
      await runImport(page, { fn: "importCsv", name: file.name, type: "text/csv", text: file.text })
    ).toContain("2 added");
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
    expect(
      await page.evaluate(
        () => window.inventory.find((item) => item.uuid === "cdp-ase-2022")?.tradedFromUuid
      )
    ).toBe("cdp-ase-2024");
  });

  test("a legacy mixed-ending CSV imports clean non-final Collections values", async ({ page }) => {
    await seedAndGoto(page, [{ ...SEED[0], tradedFromUuid: "cdp-ase-2024" }, SEED[1]]);
    await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022");
    });
    const file = await captureDownload(page, "exportCsv");
    const legacyCsv = file.text.replace(/^(# exportOrigin: [^\r\n]*)\r\n/, "$1\n");
    expect(legacyCsv).toMatch(/^# exportOrigin: [^\r\n]*\n[^\r]/);
    expect(legacyCsv).toContain("\r\n");
    await resetForCsvImport(page);
    const { toast, parsed } = await runCsvImportCapturingParse(page, {
      fn: "importCsv",
      name: "legacy.csv",
      type: "text/csv",
      text: legacyCsv,
    });
    expect(toast).toContain("2 added");
    expect(parsed.meta.fields.every((field) => !field.endsWith("\r"))).toBe(true);
    expect(parsed.data.flatMap(Object.values).every((value) => !String(value).endsWith("\r"))).toBe(
      true
    );
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
    expect(
      await page.evaluate(
        () => window.inventory.find((item) => item.uuid === "cdp-ase-2022")?.tradedFromUuid
      )
    ).toBe("cdp-ase-2024");
  });

  test("a lowercase Collections header retains membership on import", async ({ page }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022"));
    const file = await captureDownload(page, "exportCsv");
    const csv = file.text.replace(/,Collections\r\n/, ", collections \r\n");
    expect(csv).not.toBe(file.text);

    await resetForCsvImport(page);
    expect(
      await runImport(page, { fn: "importCsv", name: "lowercase.csv", type: "text/csv", text: csv })
    ).toContain("2 added");
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
  });

  test("CSV parsing preserves a quoted terminal carriage return before Notes sanitization", async ({
    page,
  }) => {
    await seedAndGoto(page, [{ ...SEED[0], notes: "Line with a terminal CR" }, SEED[1]]);
    const file = await captureDownload(page, "exportCsv");
    const csv = file.text.replace("Line with a terminal CR", '"Line with a terminal CR\r"');
    expect(csv).toContain('"Line with a terminal CR\r"');
    await resetForCsvImport(page);
    const { toast, parsed } = await runCsvImportCapturingParse(page, {
      fn: "importCsv",
      name: file.name,
      type: "text/csv",
      text: csv,
    });
    expect(toast).toContain("2 added");
    expect(parsed.data[0]["Notes"]).toBe("Line with a terminal CR\r");
    expect(
      await page.evaluate(
        () => window.inventory.find((item) => item.uuid === "cdp-ase-2022")?.notes
      )
    ).toBe("Line with a terminal CR");
  });

  test("Export CSV writes a Collections column, and a CSV whose ONLY change is that column still applies", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.waitForFunction(
      () => typeof window.exportCsv === "function" && typeof window.importCsv === "function"
    );
    await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022");
      window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024");
    });

    const file = await captureDownload(page, "exportCsv");
    const header = file.text.split("\n").find((line) => line.includes("UUID")) || "";
    expect(header).toContain("Collections");
    expect(file.text).toContain("ase-type2:2024");
    expect(file.text).toContain("ase-type2:2022");

    // Establish the items VIA an import (the STRK-220 pattern in import-export.spec.js): a
    // seeded item carries pcgsVerified:false where a CSV row yields null, so it never settles
    // to a zero diff. Items the importer created are already in CSV-normalized form.
    await page.evaluate(() => {
      window.inventory.length = 0;
      localStorage.setItem("metalInventory", "[]");
    });
    const csvImport = { fn: "importCsv", name: "inventory.csv", type: "text/csv", text: file.text };
    expect(await runImport(page, csvImport)).toContain("2 added");

    // Existing items, Collections wiped: totalChanges === 0 (the STRK-220 trap).
    await wipeCollections(page);
    const toast = await runImport(page, {
      fn: "importCsv",
      name: "inventory.csv",
      type: "text/csv",
      text: file.text,
    });

    expect(toast).toBe("Import complete: collections updated");
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
  });

  test("a CSV import links the Items it CREATES, after their identity is stamped", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.waitForFunction(
      () => typeof window.exportCsv === "function" && typeof window.importCsv === "function"
    );
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024"));
    const file = await captureDownload(page, "exportCsv");

    // A fresh device: no inventory and no Collections.
    await page.evaluate(() => {
      window.inventory.length = 0;
      // "[]" (not a removed key) so the init script does not re-seed on the reload below.
      localStorage.setItem("metalInventory", "[]");
    });
    await wipeCollections(page);

    const toast = await runImport(page, {
      fn: "importCsv",
      name: "inventory.csv",
      type: "text/csv",
      text: file.text,
    });

    expect(toast).toContain("2 added");
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
    await reloadCollections(page);
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
  });

  test("a quota failure leaves no partial CSV links and reports an incomplete import", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022");
      window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024");
    });
    const file = await captureDownload(page, "exportCsv");
    await wipeCollections(page);
    await injectCollectionQuota(page);
    const csv = { fn: "importCsv", name: "inventory.csv", type: "text/csv", text: file.text };
    const toast = await runImport(page, { ...csv, failure: true });
    expect(toast).toContain("Collections could not be saved");
    expect(await primaryOf(page, "2022")).toBeNull();
    expect(await primaryOf(page, "2024")).toBeNull();
    await clearCollectionQuota(page);
    expect(await runImport(page, csv)).toMatch(/^Import complete/);
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
  });

  test("an older CSV with a carriage return on its final Traded From UUID header keeps the link", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => {
      window.inventory[0].tradedFromUuid = "cdp-ase-2024";
    });
    const file = await captureDownload(page, "exportCsv");
    const legacyCsv = await page.evaluate((csv) => {
      const parsed = window.Papa.parse(csv, {
        header: true,
        comments: "#",
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
      });
      const fields = parsed.meta.fields.filter((field) => field !== "Collections");
      return `# older export\n${window.Papa.unparse({ fields, data: parsed.data }, { newline: "\r\n" })}`;
    }, file.text);
    expect(legacyCsv).toContain("Traded From UUID\r\n");
    await page.evaluate(() => {
      window.inventory.length = 0;
      localStorage.setItem("metalInventory", "[]");
    });
    const { toast, parsed } = await runCsvImportCapturingParse(page, {
      fn: "importCsv",
      name: "legacy.csv",
      type: "text/csv",
      text: legacyCsv,
    });
    expect(toast).toMatch(/^Import complete/);
    expect(parsed.data[0]["Traded From UUID"]).toBe("cdp-ase-2024");
    expect(
      await page.evaluate(
        () => window.inventory.find((item) => item.uuid === "cdp-ase-2022")?.tradedFromUuid
      )
    ).toBe("cdp-ase-2024");
  });
});

/**
 * Build the raw collectionState string another device would have pushed.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {{slotId: string, uuid: string, now: string}} link - The other device's one link.
 * @returns {Promise<string>} Raw localStorage value as it rides the sync vault.
 */
const remoteDeviceState = (page, link) =>
  page.evaluate(({ slotId, uuid, now }) => {
    const core = window.collectionsCore;
    const state = core.createEmptyState();
    core.ensureCollection(state, {
      id: "ase-type2",
      kind: "template",
      templateSlug: "ase-type2",
      now,
    });
    core.linkItem(state, "ase-type2", slotId, uuid, { now });
    return JSON.stringify(state);
  }, link);

test.describe("core/collections-data-paths — cloud sync contract (STRK-370)", () => {
  test.beforeEach(async ({ page }) => {
    await seedAndGoto(page);
    await page.waitForFunction(
      () =>
        !!window.CloudSyncTest && typeof window.CloudSyncTest.mergeCollectionState === "function"
    );
  });

  test("SCOPE + EXCLUDE: collectionState rides the sync vault and is a managed key", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024");
      return {
        inSyncVault: Object.prototype.hasOwnProperty.call(
          window.collectVaultData("sync").data,
          "collectionState"
        ),
        managed: window.CloudSyncTest.isManagedSyncKey("collectionState"),
      };
    });
    expect(result).toEqual({ inSyncVault: true, managed: true });
  });

  test("two devices: a Slot filled here and a Slot filled there BOTH survive the pull, durably and idempotently", async ({
    page,
  }) => {
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022"));
    const remote = await remoteDeviceState(page, {
      slotId: "2024",
      uuid: "cdp-ase-2024",
      now: "2026-09-18T11:00:00.000Z",
    });

    const before = await page.evaluate(
      (raw) => window.CloudSyncTest.hasCollectionStateChange({ collectionState: raw }),
      remote
    );
    expect(before).toBe(true); // the manifest fast path must NOT swallow this

    await page.evaluate(
      (raw) => window.CloudSyncTest.mergeCollectionState({ collectionState: raw }),
      remote
    );
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");

    // Converged: the same remote no longer reads as a change, so no apply loop.
    const after = await page.evaluate(
      (raw) => window.CloudSyncTest.hasCollectionStateChange({ collectionState: raw }),
      remote
    );
    expect(after).toBe(false);

    await reloadCollections(page);
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
  });

  test("a newer unlink here beats an OLDER link arriving from the other device", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024");
      window.collectionsStore.unlink("ase-type2", "2024", "cdp-ase-2024");
    });
    const staleRemote = await remoteDeviceState(page, {
      slotId: "2024",
      uuid: "cdp-ase-2024",
      now: "2020-01-01T00:00:00.000Z",
    });

    const result = await page.evaluate((raw) => {
      const changed = window.CloudSyncTest.hasCollectionStateChange({ collectionState: raw });
      window.CloudSyncTest.mergeCollectionState({ collectionState: raw });
      return changed;
    }, staleRemote);

    expect(result).toBe(false);
    expect(await primaryOf(page, "2024")).toBeNull();
  });

  test("HOLD: a failed write throws for the caller and leaves local Collections untouched", async ({
    page,
  }) => {
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022"));
    const remote = await remoteDeviceState(page, {
      slotId: "2024",
      uuid: "cdp-ase-2024",
      now: "2026-09-18T11:00:00.000Z",
    });

    const outcome = await page.evaluate((raw) => {
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "collectionState") throw new DOMException("full", "QuotaExceededError");
        return realSetItem.call(this, key, value);
      };
      try {
        window.CloudSyncTest.mergeCollectionState({ collectionState: raw });
        return "no-throw";
      } catch (error) {
        return String(error.message);
      } finally {
        Storage.prototype.setItem = realSetItem;
      }
    }, remote);

    expect(outcome).toContain("save-failed");
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
    expect(await primaryOf(page, "2024")).toBeNull();
  });

  test("a Collections-only edit schedules its own sync push", async ({ page }) => {
    const pushes = await page.evaluate(() => {
      let count = 0;
      window.scheduleSyncPush = () => {
        count += 1;
      };
      window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024");
      return count;
    });
    expect(pushes).toBeGreaterThan(0);
  });

  test("a JSON import cannot blind-overwrite Collections through its settings block", async ({
    page,
  }) => {
    await page.waitForFunction(() => typeof window.importJson === "function");
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024"));
    const text = await page.evaluate(() =>
      JSON.stringify({
        // Real items: an empty list short-circuits on "No items to import" before any diff.
        items: window.inventory.map((item) => ({ ...item })),
        settings: {
          collectionState: JSON.stringify(window.collectionsCore.createEmptyState()),
          appTheme: localStorage.getItem("appTheme") === "light" ? "dark" : "light",
        },
      })
    );

    await page.evaluate(
      (json) =>
        new Promise((resolve) => {
          const origShow = window.DiffModal.show;
          window.DiffModal.show = (config) => {
            window.DiffModal.show = origShow;
            const keys = ((config.settingsDiff && config.settingsDiff.changed) || []).map(
              (change) => change.key
            );
            window.__cdpSettingsKeys = keys;
            resolve();
          };
          window.importJson(new File([json], "settings.json", { type: "application/json" }), false);
        }),
      text
    );

    expect(await page.evaluate(() => window.__cdpSettingsKeys)).not.toContain("collectionState");
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
  });
});

const CLOUD_ACCOUNT = "dbid:collections-two-device";
const CLOUD_PASSWORD = "collections-test-password";

/** Seeds the same mock Dropbox account on independent browser devices. */
const seedCloudCredentials = (page) =>
  page.addInitScript(
    ({ account, password }) => {
      localStorage.setItem("cloud_dropbox_account_id", account);
      localStorage.setItem("cloud_vault_password", password);
      localStorage.setItem("cloud_sync_migrated", "v2");
      localStorage.setItem(
        "cloud_token_dropbox",
        JSON.stringify({
          access_token: "sl.collections-test-token",
          expires_at: Date.now() + 3600000,
        })
      );
    },
    { account: CLOUD_ACCOUNT, password: CLOUD_PASSWORD }
  );

/** Serves device A's encrypted files as Dropbox downloads on device B. */
const routeCollectionDropbox = async (page, files) => {
  await page.route("https://content.dropboxapi.com/2/files/download", (route) => {
    const path = JSON.parse(route.request().headers()["dropbox-api-arg"] || "{}").path || "";
    const bytes = path.endsWith(".stmanifest")
      ? files.manifest
      : path.endsWith("staktrakr-sync.stvault")
        ? files.vault
        : path.endsWith("staktrakr-images.stvault")
          ? files.images
          : null;
    return bytes
      ? route.fulfill({
          status: 200,
          contentType: "application/octet-stream",
          body: Buffer.from(bytes),
        })
      : route.fulfill({ status: 409, body: "{}" });
  });
  await page.route("https://content.dropboxapi.com/2/files/upload", (route) => {
    const path = JSON.parse(route.request().headers()["dropbox-api-arg"] || "{}").path || "";
    if (files.onUpload) files.onUpload(path);
    if (path.endsWith("staktrakr-images.stvault") && files.failImageUploads > 0) {
      files.failImageUploads -= 1;
      return route.fulfill({ status: 503, body: "{}" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"rev":"mock-rev"}',
    });
  });
  await page.route("https://api.dropboxapi.com/2/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  );
};

/** Encrypts device A's current sync vault without changing the remote mock. */
const deviceVault = async (page) => {
  const payload = await page.evaluate(() => window.collectVaultData("sync"));
  return encryptVaultPayload(page, payload, `${CLOUD_PASSWORD}:${CLOUD_ACCOUNT}`);
};

const deviceManifest = (page, changes = []) =>
  page.evaluate(
    async ({ account, password, itemChanges }) =>
      Array.from(
        new Uint8Array(
          await window.encryptManifest(
            {
              version: 2,
              changes: itemChanges,
              settings: { collectionState: localStorage.getItem("collectionState") },
            },
            `${password}:${account}`
          )
        )
      ),
    { account: CLOUD_ACCOUNT, password: CLOUD_PASSWORD, itemChanges: changes }
  );

const prepareDevices = async (browser, page) => {
  const context = await browser.newContext();
  const deviceA = await context.newPage();
  await seedCloudCredentials(deviceA);
  await seedCloudCredentials(page);
  await seedAndGoto(deviceA);
  await seedAndGoto(page);
  return { deviceA, close: () => context.close() };
};

/**
 * Runs a two-device body with the second device's context always torn down.
 * Every two-device case repeated the same setTimeout + prepare + try/finally
 * preamble, which is the bulk of this file's duplication (PR 1500 review).
 * @param {import('@playwright/test').Browser} browser - Playwright browser.
 * @param {import('@playwright/test').Page} page - The receiving device.
 * @param {(deviceA: import('@playwright/test').Page) => Promise<void>} body - Test body.
 * @returns {Promise<void>}
 */
const withDevices = async (browser, page, body) => {
  test.setTimeout(60000);
  const { deviceA, close } = await prepareDevices(browser, page);
  try {
    await body(deviceA);
  } finally {
    await close();
  }
};

const remoteCollectionMeta = (syncId) => ({
  syncId,
  rev: `${syncId}-rev`,
  timestamp: Date.now(),
  deviceId: "device-a",
  itemCount: SEED.length,
});

const injectCollectionQuota = (page) =>
  page.evaluate(() => {
    window.__lastPullBeforeQuota = localStorage.getItem("cloud_sync_last_pull");
    const real = Storage.prototype.setItem;
    window.__collectionRealSetItem = real;
    let failed = false;
    Storage.prototype.setItem = function (key, value) {
      if (key === "collectionState" && !failed) {
        failed = true;
        throw new DOMException("full", "QuotaExceededError");
      }
      return real.call(this, key, value);
    };
  });

const clearCollectionQuota = (page) =>
  page.evaluate(() => {
    Storage.prototype.setItem = window.__collectionRealSetItem;
  });

test.describe("core/collections-data-paths — mock Dropbox two-device pulls", () => {
  test("a failed artwork upload holds sync metadata and retries automatically", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("cloud_sync_enabled", "true"));
    await seedCloudCredentials(page);
    await seedAndGoto(page);
    await page.evaluate(async () => {
      const created = window.collectionsStore.createCustom({
        name: "Retry art",
        slots: [{ label: "One" }],
      });
      const response = await fetch("/tests/playwright/helpers/test-obverse.png");
      await window.collectionsPicker.saveImage(
        created.collection.id,
        null,
        new File([await response.blob()], "art.png", { type: "image/png" })
      );
      const original = window.setTimeout;
      window.__imageRetryTimeout = original;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 30000) {
          window.__imageRetry = callback;
          return 1;
        }
        return original(callback, delay, ...args);
      };
    });
    const uploads = [];
    await routeCollectionDropbox(page, {
      failImageUploads: 1,
      onUpload: (path) => uploads.push(path),
    });
    await page.evaluate(() => window.pushSyncVault());
    expect(uploads.some((path) => path.endsWith("staktrakr-images.stvault"))).toBe(true);
    expect(uploads.some((path) => path.endsWith("staktrakr-sync.json"))).toBe(false);
    await page.evaluate(() => {
      window.setTimeout = window.__imageRetryTimeout;
      window.__imageRetry();
    });
    await expect
      .poll(() => uploads.some((path) => path.endsWith("staktrakr-sync.json")))
      .toBe(true);
  });

  test("Custom Collection cover and Slot art arrive on a second device; removals keep old vault bytes hidden", async ({
    browser,
    page,
  }) => {
    await withDevices(browser, page, async (deviceA) => {
      const art = await deviceA.evaluate(async () => {
        const created = window.collectionsStore.createCustom({
          name: "Two device art",
          slots: [{ label: "First" }],
        });
        const collectionId = created.collection.id;
        const slotId = created.collection.definition.slots[0].id;
        const response = await fetch("/tests/playwright/helpers/test-obverse.png");
        const file = new File([await response.blob()], "art.png", { type: "image/png" });
        const coverSaved = await window.collectionsPicker.saveImage(collectionId, null, file);
        const slotSaved = await window.collectionsPicker.saveImage(collectionId, slotId, file);
        return { collectionId, slotId, coverSaved, slotSaved };
      });
      expect(art.coverSaved).toBe(true);
      expect(art.slotSaved).toBe(true);
      const imageVault = await deviceA.evaluate(
        async ({ account, password }) => {
          const images = await window.collectAndHashImageVault();
          return {
            hash: images.hash,
            imageCount: images.imageCount,
            bytes: Array.from(
              await window.vaultEncryptImageVault(`${password}:${account}`, images.payload)
            ),
          };
        },
        { account: CLOUD_ACCOUNT, password: CLOUD_PASSWORD }
      );
      const oldFiles = { manifest: await deviceManifest(deviceA), images: imageVault.bytes };
      const uploadMeta = {
        ...remoteCollectionMeta("art-upload"),
        imageVault: { hash: imageVault.hash, imageCount: imageVault.imageCount },
      };
      const priorPull = await page.evaluate(() => window.syncGetLastPull());
      await routeCollectionDropbox(page, { manifest: oldFiles.manifest });
      await page.evaluate((remote) => window.pullWithPreview(remote), uploadMeta);
      expect(await page.evaluate(() => window.syncGetLastPull())).toEqual(priorPull);
      await page.unrouteAll();
      await routeCollectionDropbox(page, oldFiles);
      await page.evaluate((remote) => window.pullWithPreview(remote), uploadMeta);
      await page.evaluate((id) => window.collectionsUI.openCollection(id), art.collectionId);
      await expect(page.locator(".collections-album-head .collections-coin img")).toHaveAttribute(
        "src",
        /^blob:/
      );
      await expect(
        page.locator(`[data-slot-id="${art.slotId}"] .collections-coin img`)
      ).toHaveAttribute("src", /^blob:/);

      await deviceA.evaluate(async ({ collectionId, slotId }) => {
        await window.collectionsPicker.deleteImage(collectionId, null);
        await window.collectionsPicker.deleteImage(collectionId, slotId);
      }, art);
      const removedManifest = await deviceManifest(deviceA);
      await page.unrouteAll();
      await routeCollectionDropbox(page, { ...oldFiles, manifest: removedManifest });
      await page.evaluate(
        (remote) => window.pullWithPreview(remote),
        remoteCollectionMeta("art-removal")
      );
      await page.evaluate(() => window.collectionsUI.render());
      await expect(page.locator(".collections-album-head .collections-coin img")).toHaveCount(0);
      await expect(
        page.locator(`[data-slot-id="${art.slotId}"] .collections-coin img`)
      ).toHaveCount(0);
      const oldVaultRejected = await page.evaluate(async (bytes) => {
        await window.vaultDecryptAndRestoreImages(
          new Uint8Array(bytes),
          `${"collections-test-password"}:${"dbid:collections-two-device"}`
        );
        window.collectionsUI.render();
        return window.collectionsStore.getState();
      }, imageVault.bytes);
      expect(oldVaultRejected.collections[art.collectionId].artwork.cover.present).toBe(false);
      await expect(page.locator(".collections-album-head .collections-coin img")).toHaveCount(0);
    });
  });

  test("vault-first Collections-only pull merges concurrent Slots and retries after quota rollback", async ({
    browser,
    page,
  }) => {
    await withDevices(browser, page, async (deviceA) => {
      await deviceA.evaluate(() =>
        window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024")
      );
      await page.evaluate(() => window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022"));
      await routeCollectionDropbox(page, { vault: await deviceVault(deviceA) });
      await page.evaluate(() => {
        window.DiffModal.show = (options) => options.onApply([]);
      });
      const meta = remoteCollectionMeta("remote-collections");
      await injectCollectionQuota(page);
      await page.evaluate((remote) => window.pullWithPreview(remote), meta);
      expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
      expect(await primaryOf(page, "2024")).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem("cloud_sync_last_pull"))).toBe(
        await page.evaluate(() => window.__lastPullBeforeQuota)
      );

      await clearCollectionQuota(page);
      const priorInventory = await page.evaluate(() => localStorage.getItem("metalInventory"));
      await page.evaluate(() => {
        const real = Storage.prototype.setItem;
        window.__inventoryRealSetItem = real;
        Storage.prototype.setItem = function (key, value) {
          if (key === "metalInventory") throw new DOMException("full", "QuotaExceededError");
          return real.call(this, key, value);
        };
      });
      await page.evaluate((remote) => window.pullWithPreview(remote), meta);
      expect(await primaryOf(page, "2024")).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem("metalInventory"))).toBe(
        priorInventory
      );
      expect(await page.evaluate(() => localStorage.getItem("cloud_sync_last_pull"))).toBe(
        await page.evaluate(() => window.__lastPullBeforeQuota)
      );
      await page.evaluate(() => {
        Storage.prototype.setItem = window.__inventoryRealSetItem;
      });
      await page.evaluate((remote) => window.pullWithPreview(remote), meta);
      expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
      expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
    });
  });

  test("manifest Collections-only pull adds a concurrent Slot but preserves a newer unlink", async ({
    browser,
    page,
  }) => {
    await withDevices(browser, page, async (deviceA) => {
      await deviceA.evaluate(() => {
        const core = window.collectionsCore;
        const state = core.createEmptyState();
        core.ensureCollection(state, {
          id: "ase-type2",
          kind: "template",
          now: "2020-01-01T00:00:00.000Z",
        });
        core.linkItem(state, "ase-type2", "2024", "cdp-ase-2024", {
          now: "2020-01-02T00:00:00.000Z",
        });
        core.linkItem(state, "ase-type2", "2022", "cdp-ase-2022", {
          now: "2020-01-02T00:00:00.000Z",
        });
        window.collectionsStore.mergeIn(state);
      });
      await page.evaluate(() => {
        window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022");
        window.collectionsStore.unlink("ase-type2", "2022", "cdp-ase-2022");
      });
      await routeCollectionDropbox(page, { manifest: await deviceManifest(deviceA) });
      await page.evaluate(() => {
        window.DiffModal.show = () => {
          throw new Error("Collections-only pull opened a modal");
        };
      });
      await page.evaluate(
        (remote) => window.pullWithPreview(remote),
        remoteCollectionMeta("manifest-only")
      );
      expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
      expect(await primaryOf(page, "2022")).toBeNull();
    });
  });

  test("manifest deferred apply stops on rollback, then retries without losing either device's Slot", async ({
    browser,
    page,
  }) => {
    await withDevices(browser, page, async (deviceA) => {
      await deviceA.evaluate(() =>
        window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024")
      );
      await page.evaluate(() => window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022"));
      const manifest = await deviceManifest(deviceA, [
        {
          itemKey: "edit-2024",
          itemName: "2024 American Silver Eagle BU",
          type: "item-edit",
          fields: [{ field: "Name", oldValue: "old", newValue: "new" }],
        },
      ]);
      await routeCollectionDropbox(page, { manifest, vault: await deviceVault(deviceA) });
      await page.evaluate(() => {
        window.DiffModal.show = (options) => options.onApply([]);
      });
      const meta = remoteCollectionMeta("manifest-deferred");
      await injectCollectionQuota(page);
      await page.evaluate((remote) => window.pullWithPreview(remote), meta);
      expect(await primaryOf(page, "2024")).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem("cloud_sync_last_pull"))).toBe(
        await page.evaluate(() => window.__lastPullBeforeQuota)
      );
      await clearCollectionQuota(page);
      await page.evaluate((remote) => window.pullWithPreview(remote), meta);
      expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
      expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
    });
  });
});

/**
 * Captures every Dropbox RPC path the page calls, so a test can assert that a
 * destructive call (files/delete_v2) was never issued. Registered AFTER
 * routeCollectionDropbox so it wins the generic api.dropboxapi.com/2/** route.
 */
const captureDropboxRpc = async (page, calls) => {
  await page.route("https://api.dropboxapi.com/2/**", async (route) => {
    const request = route.request();
    let body = {};
    try {
      body = JSON.parse(request.postData() || "{}");
    } catch {
      body = {};
    }
    calls.push({ url: request.url(), path: body.path || "" });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
};

test.describe("core/collections-data-paths — commit ordering (PR 1500 review)", () => {
  test("a transient image-cache failure never deletes the remote image vault", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("cloud_sync_enabled", "true"));
    await seedCloudCredentials(page);
    await seedAndGoto(page);

    // This device has already pushed the current image vault, so lastImageHash is
    // set — exactly the state in which the deletion branch is reachable.
    await page.evaluate(() =>
      localStorage.setItem(
        "cloud_sync_last_push",
        JSON.stringify({ syncId: "push-1", timestamp: Date.now(), imageHash: "img-hash-1" })
      )
    );

    // IndexedDB goes away mid-session. exportAll* return [] on a dead connection,
    // which is byte-identical to "the user deleted every photo".
    await page.evaluate(() => {
      window.imageCache.isAvailable = () => false;
      window.imageCache.exportAllUserImages = async () => [];
      window.imageCache.exportAllPatternImages = async () => [];
    });

    const calls = [];
    await routeCollectionDropbox(page, {});
    await captureDropboxRpc(page, calls);
    await page.evaluate(() => window.pushSyncVault());

    expect(calls.some((call) => call.url.includes("files/delete_v2"))).toBe(false);
  });

  test("collectAndHashImageVault reports an unreadable cache instead of an empty one", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const unreadable = await page.evaluate(async () => {
      window.imageCache.isAvailable = () => false;
      window.imageCache.exportAllUserImages = async () => [];
      window.imageCache.exportAllPatternImages = async () => [];
      return window.collectAndHashImageVault();
    });
    expect(unreadable).toEqual({ enumerationFailed: true });

    const genuinelyEmpty = await page.evaluate(async () => {
      window.imageCache.isAvailable = () => true;
      window.imageCache.exportAllUserImages = async () => [];
      window.imageCache.exportAllPatternImages = async () => [];
      return window.collectAndHashImageVault();
    });
    expect(genuinelyEmpty).toBeNull();
  });

  test("a partly-failed photo import warns instead of rolling the restore back", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const art = await page.evaluate(async () => {
      const created = window.collectionsStore.createCustom({
        name: "Partial photos",
        slots: [{ label: "One" }],
      });
      const collectionId = created.collection.id;
      const response = await fetch("/tests/playwright/helpers/test-obverse.png");
      const file = new File([await response.blob()], "art.png", { type: "image/png" });
      await window.collectionsPicker.saveImage(collectionId, null, file);
      const imageData = await window.collectAndHashImageVault();
      const password = "partial-photo-key";
      const images = Array.from(await window.vaultEncryptImageVault(password, imageData.payload));

      // Capture the vault with ONE modified item so the restore takes the DiffModal
      // apply path (_vaultApplyRestoreSelection) rather than the no-change branch —
      // the rollback under test lives only on the apply path.
      const originalName = window.inventory[0].name;
      window.inventory[0].name = "Renamed for the diff";
      window.tryPersistInventory();
      const payload = window.collectVaultData("full");
      window.inventory[0].name = originalName;
      window.tryPersistInventory();
      return { collectionId, images, password, payload };
    });
    const vault = await encryptVaultPayload(page, art.payload, art.password);

    const result = await page.evaluate(
      async ({ images, password, bytes }) => {
        // DiffModal.show is fire-and-forget from vaultRestoreWithPreview's view, so
        // the apply — and the companion photo restore that follows it — outlives the
        // outer await. Expose a promise the test can actually wait on.
        let settleApply;
        const applied = new Promise((resolve) => {
          settleApply = resolve;
        });
        window.DiffModal.show = (options) => {
          Promise.resolve(options.onApply([])).then(settleApply, settleApply);
        };
        // Every photo write fails, and restoreImageVaultData throws only after the
        // loop — by which point the main restore has already committed and the
        // overwritten IndexedDB blobs are unrecoverable.
        window.imageCache.importUserImageRecord = async () => false;
        window.imageCache.importPatternImageRecord = async () => false;

        const toasts = [];
        const realToast = window.showToast;
        window.showToast = (message, ...rest) => {
          toasts.push(String(message));
          return realToast ? realToast(message, ...rest) : undefined;
        };

        window.setVaultPendingImageFile(new Uint8Array(images));
        await window.vaultRestoreWithPreview(new Uint8Array(bytes), password);
        await applied;
        return { toasts };
      },
      { images: art.images, password: art.password, bytes: vault }
    );

    // The restore is reported as having succeeded — items, settings and Collections
    // are committed and must not be reverted to pair with half-replaced photos...
    expect(result.toasts.some((text) => /^Backup restored/.test(text))).toBe(true);
    // ...and the photo shortfall is a warning on that success, not a failed restore.
    expect(result.toasts.some((text) => /photos could not be imported/i.test(text))).toBe(true);
    expect(result.toasts.some((text) => /^Restore failed/.test(text))).toBe(false);
  });

  test("a delete suppressed by recovery mode does not prune Collection membership", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022"));
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");

    // Recovery mode makes saveInventory() a no-op, so the item survives a reload.
    // Pruning its membership anyway tombstones a link whose item still exists.
    await page.evaluate(async () => {
      window.setInventoryRecoveryActive(true);
      const idx = window.inventory.findIndex((item) => item.uuid === "cdp-ase-2022");
      document.getElementById("removeItemIdx").value = String(idx);
      document.getElementById("removeItemDisposeCheck").checked = false;
      await window.confirmRemoveItem();
    });

    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
  });
});

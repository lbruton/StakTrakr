import { test, expect } from "../../helpers/mocks/extended-test.js";

const ACCOUNT_ID = "dbid:strk101-test-account";
const VAULT_PASSWORD = "strk101-test-password";
const SYNC_KEY = `${VAULT_PASSWORD}:${ACCOUNT_ID}`;

const LOCAL_ITEM = {
  uuid: "strk101-local",
  serial: 1,
  metal: "Silver",
  composition: "Silver",
  name: "STRK-101 Local Eagle",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 31,
  date: "2026-05-23",
  obverseImageFrame: "round",
};

async function seedCloudState(page, inventory = [LOCAL_ITEM], changeLog = []) {
  await page.addInitScript(
    ({ accountId, password, inventorySeed, changeLogSeed }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inventorySeed));
      localStorage.setItem("changeLog", JSON.stringify(changeLogSeed));
      localStorage.setItem("cloud_dropbox_account_id", accountId);
      localStorage.setItem("cloud_sync_enabled", "true");
      localStorage.setItem("cloud_sync_migrated", "v2");
      localStorage.setItem("cloud_vault_password", password);
      localStorage.setItem(
        "cloud_token_dropbox",
        JSON.stringify({
          access_token: "sl.strk101-test-token",
          expires_at: Date.now() + 3600000,
        })
      );
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
        },
        { once: true }
      );
    },
    {
      accountId: ACCOUNT_ID,
      password: VAULT_PASSWORD,
      inventorySeed: inventory,
      changeLogSeed: changeLog,
    }
  );
}

async function gotoCloudReady(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.pushSyncVault === "function" &&
      typeof window.pullWithPreview === "function" &&
      typeof window.encryptManifest === "function" &&
      typeof window.decryptManifest === "function" &&
      typeof window.DiffModal !== "undefined"
  );
}

function dropboxPath(route) {
  const arg = route.request().headers()["dropbox-api-arg"];
  if (!arg) return "";
  try {
    return JSON.parse(arg).path || "";
  } catch {
    return "";
  }
}

async function routeDropbox(page, options = {}) {
  await page.route("https://content.dropboxapi.com/2/files/download", async (route) => {
    const path = dropboxPath(route);
    if (path.endsWith(".stmanifest") && options.manifestBytes) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(options.manifestBytes),
      });
      return;
    }
    await route.fulfill({ status: 409, body: "{}" });
  });

  await page.route("https://content.dropboxapi.com/2/files/upload", async (route) => {
    const path = dropboxPath(route);
    if (path.endsWith(".stmanifest") && options.onManifestUpload) {
      await options.onManifestUpload(await route.request().postDataBuffer());
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rev: "rev-strk101" }),
    });
  });

  await page.route("https://api.dropboxapi.com/2/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function encryptedManifest(page, manifest) {
  return page.evaluate(
    async ({ payload, key }) =>
      Array.from(new Uint8Array(await window.encryptManifest(payload, key))),
    { payload: manifest, key: SYNC_KEY }
  );
}

async function captureManifestPreview(page, manifest) {
  const manifestBytes = await encryptedManifest(page, manifest);
  await routeDropbox(page, { manifestBytes });
  await page.evaluate(() => {
    window.__strk101Preview = null;
    window.DiffModal.show = (options) => {
      window.__strk101Preview = {
        diff: options.diff,
        conflicts: options.conflicts || null,
      };
      if (typeof options.onCancel === "function") options.onCancel();
      return Promise.resolve();
    };
  });
  await page.evaluate(() =>
    window.pullWithPreview({
      syncId: "remote-sync",
      timestamp: Date.now(),
      rev: "remote-rev",
      itemCount: 1,
      deviceId: "remote-device",
    })
  );
  return page.evaluate(() => window.__strk101Preview);
}

test.describe("STRK-101 — manifest item change type normalization", () => {
  test("pull manifest classifies item-add, item-edit, and item-delete entries", async ({
    page,
  }) => {
    await seedCloudState(page);
    await gotoCloudReady(page);

    const preview = await captureManifestPreview(page, {
      version: 1,
      changes: [
        { itemKey: "add-key", itemName: "Added item", type: "item-add", fields: [] },
        {
          itemKey: "edit-key",
          itemName: "Edited item",
          type: "item-edit",
          fields: [{ field: "Name", oldValue: "Old", newValue: "New" }],
        },
        { itemKey: "delete-key", itemName: "Deleted item", type: "item-delete", fields: [] },
      ],
      summary: { itemsAdded: 1, itemsEdited: 1, itemsDeleted: 1, settingsChanged: 0 },
    });

    expect(preview.diff.added.map((entry) => entry.itemKey)).toEqual(["add-key"]);
    expect(preview.diff.modified.map((entry) => entry.item.itemKey)).toEqual(["edit-key"]);
    expect(preview.diff.deleted.map((entry) => entry.itemKey)).toEqual(["delete-key"]);
  });

  test("push manifest writes normalized counts and chronological merged types", async ({
    page,
  }) => {
    let uploadedManifestBytes = null;
    const changeLog = [
      {
        timestamp: 1,
        itemKey: "edit-delete",
        itemName: "A",
        type: "item-edit",
        field: "Name",
        oldValue: "A",
        newValue: "B",
      },
      {
        timestamp: 2,
        itemKey: "edit-delete",
        itemName: "A",
        type: "item-delete",
        field: "Deleted",
        oldValue: "B",
        newValue: null,
      },
      {
        timestamp: 3,
        itemKey: "add-edit",
        itemName: "B",
        type: "item-add",
        field: "Added",
        oldValue: null,
        newValue: "{}",
      },
      {
        timestamp: 4,
        itemKey: "add-edit",
        itemName: "B",
        type: "item-edit",
        field: "Name",
        oldValue: "B",
        newValue: "C",
      },
      {
        timestamp: 5,
        itemKey: "add-delete",
        itemName: "C",
        type: "item-add",
        field: "Added",
        oldValue: null,
        newValue: "{}",
      },
      {
        timestamp: 6,
        itemKey: "add-delete",
        itemName: "C",
        type: "item-delete",
        field: "Deleted",
        oldValue: "{}",
        newValue: null,
      },
      {
        timestamp: 7,
        itemKey: "delete-add",
        itemName: "D",
        type: "item-delete",
        field: "Deleted",
        oldValue: "{}",
        newValue: null,
      },
      {
        timestamp: 8,
        itemKey: "delete-add",
        itemName: "D",
        type: "item-add",
        field: "Added",
        oldValue: null,
        newValue: "{}",
      },
    ];

    await seedCloudState(page, [LOCAL_ITEM], changeLog);
    await routeDropbox(page, {
      onManifestUpload: async (bytes) => {
        uploadedManifestBytes = Array.from(bytes);
      },
    });
    await gotoCloudReady(page);

    await page.evaluate(() => window.pushSyncVault());
    expect(uploadedManifestBytes).not.toBeNull();

    const manifest = await page.evaluate(
      async ({ bytes, key }) => window.decryptManifest(new Uint8Array(bytes), key),
      { bytes: uploadedManifestBytes, key: SYNC_KEY }
    );
    const byKey = Object.fromEntries(
      manifest.changes.map((change) => [change.itemKey, change.type])
    );

    expect(byKey["edit-delete"]).toBe("delete");
    expect(byKey["add-edit"]).toBe("add");
    expect(byKey["add-delete"]).toBe("delete");
    expect(byKey["delete-add"]).toBe("add");
    expect(manifest.summary).toMatchObject({
      itemsAdded: 2,
      itemsEdited: 0,
      itemsDeleted: 2,
    });
  });

  test("manifest conflict detection recognizes item-edit remote entries", async ({ page }) => {
    await seedCloudState(
      page,
      [LOCAL_ITEM],
      [
        {
          timestamp: Date.now(),
          itemKey: "conflict-key",
          itemName: "Local",
          type: "item-edit",
          field: "Name",
          oldValue: "Original",
          newValue: "Local",
        },
      ]
    );
    await gotoCloudReady(page);

    const preview = await captureManifestPreview(page, {
      version: 1,
      changes: [
        {
          itemKey: "conflict-key",
          itemName: "Remote",
          type: "item-edit",
          fields: [{ field: "Name", oldValue: "Original", newValue: "Remote" }],
        },
      ],
      summary: { itemsAdded: 0, itemsEdited: 1, itemsDeleted: 0, settingsChanged: 0 },
    });

    expect(preview.conflicts?.conflicts?.length || 0).toBeGreaterThan(0);
  });

  test("vault-first fallback still runs when manifest is unavailable", async ({ page }) => {
    await seedCloudState(page);
    await routeDropbox(page);
    await gotoCloudReady(page);

    await page.evaluate(() => {
      window.__strk101VaultDownloadAttempts = 0;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const arg = init?.headers?.["Dropbox-API-Arg"];
        if (arg && JSON.parse(arg).path?.endsWith(".stvault")) {
          window.__strk101VaultDownloadAttempts += 1;
        }
        return originalFetch(input, init);
      };
    });
    await page.evaluate(() =>
      window.pullWithPreview({
        syncId: "remote-sync",
        timestamp: Date.now(),
        rev: "remote-rev",
        itemCount: 1,
      })
    );

    expect(await page.evaluate(() => window.__strk101VaultDownloadAttempts)).toBeGreaterThan(0);
  });
});

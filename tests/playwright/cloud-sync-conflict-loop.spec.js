import { test, expect } from "./helpers/mocks/extended-test.js";

const ACCOUNT_ID = "dbid:strk107-test-account";
const VAULT_PASSWORD = "strk107-test-password";
const SYNC_KEY = `${VAULT_PASSWORD}:${ACCOUNT_ID}`;
const ITEM_KEY = "strk107-item";
const BASE_TS = 1_700_000_000_000;

const LOCAL_ITEM = {
  uuid: ITEM_KEY,
  serial: 107,
  metal: "Silver",
  composition: "Silver",
  name: "STRK-107 Local",
  qty: 1,
  type: "Round",
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 31,
  date: "2026-05-24",
  lastModified: BASE_TS + 20,
};

const REMOTE_ITEM = {
  ...LOCAL_ITEM,
  name: "STRK-107 Remote",
  lastModified: BASE_TS + 40,
};

const staleEntry = (overrides = {}) => ({
  timestamp: BASE_TS + 100,
  itemKey: ITEM_KEY,
  itemName: LOCAL_ITEM.name,
  type: "item-edit",
  field: "name",
  oldValue: "STRK-107 Original",
  newValue: LOCAL_ITEM.name,
  undone: false,
  ...overrides,
});

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
          access_token: "sl.strk107-test-token",
          expires_at: Date.now() + 3600000,
        })
      );
      localStorage.setItem(
        "cloud_sync_last_push",
        JSON.stringify({
          syncId: "local-before-acceptance",
          timestamp: BASE_TS,
          rev: "rev-local",
          itemCount: inventorySeed.length,
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
      typeof window.pullWithPreview === "function" &&
      typeof window.pushSyncVault === "function" &&
      typeof window.encryptManifest === "function" &&
      typeof window.decryptManifest === "function" &&
      typeof window.neutralizeSupersededChangelog === "function" &&
      typeof window.DiffEngine !== "undefined" &&
      typeof window.DiffEngine.applySelectedChanges === "function" &&
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
      body: JSON.stringify({ rev: "rev-strk107" }),
    });
  });

  await page.route("https://api.dropboxapi.com/2/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function acceptRemoteAndCaptureManifest(page, selectedChanges, afterApply = null) {
  let uploadedManifestBytes = null;
  await routeDropbox(page, {
    onManifestUpload: async (bytes) => {
      uploadedManifestBytes = Array.from(bytes);
    },
  });
  await page.evaluate((changes) => {
    window.__strk107ApplyCalls = 0;
    window.__strk107NeutralizeCalls = 0;
    const originalNeutralize = window.neutralizeSupersededChangelog;
    window.neutralizeSupersededChangelog = function () {
      window.__strk107NeutralizeCalls += 1;
      return originalNeutralize.apply(this, arguments);
    };
    window.DiffModal.show = (options) => {
      window.__strk107ApplyCalls += 1;
      options.onApply(changes);
      return Promise.resolve();
    };
  }, selectedChanges);

  await page.evaluate(
    ({ timestamp, diff }) =>
      window.showRestorePreviewModal(
        diff,
        null,
        { data: { metalInventory: JSON.stringify([window.inventory[0]]) } },
        {
          syncId: "remote-sync",
          timestamp,
          rev: "remote-rev",
          itemCount: 1,
          deviceId: "remote-device",
        },
        null
      ),
    {
      timestamp: BASE_TS + 300,
      diff: {
        added: [],
        deleted: [],
        unchanged: [],
        modified: [
          {
            item: REMOTE_ITEM,
            itemKey: ITEM_KEY,
            fields: selectedChanges.map((change) => ({
              field: change.field,
              oldValue: LOCAL_ITEM[change.field],
              newValue: change.value,
            })),
          },
        ],
      },
    }
  );
  await expect.poll(() => page.evaluate(() => window.__strk107ApplyCalls)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__strk107NeutralizeCalls)).toBe(1);
  if (afterApply) await afterApply();
  await expect.poll(() => uploadedManifestBytes, { timeout: 5000 }).not.toBeNull();
  return page.evaluate(
    async ({ bytes, key }) => window.decryptManifest(new Uint8Array(bytes), key),
    { bytes: uploadedManifestBytes, key: SYNC_KEY }
  );
}

const selectedNameChange = () => [
  { type: "modify", itemKey: ITEM_KEY, field: "name", value: REMOTE_ITEM.name },
];

test.describe("STRK-107 — sync conflict acceptance neutralization", () => {
  test("AC-7: accepting remote excludes stale local item changes from the next manifest", async ({
    page,
  }) => {
    await seedCloudState(page, [LOCAL_ITEM], [staleEntry()]);
    await gotoCloudReady(page);

    const manifest = await acceptRemoteAndCaptureManifest(page, selectedNameChange());

    expect(manifest.changes.map((change) => change.itemKey)).not.toContain(ITEM_KEY);
  });

  test("AC-3: stale lastModified entries are neutralized after accepting remote", async ({
    page,
  }) => {
    await seedCloudState(
      page,
      [LOCAL_ITEM],
      [
        staleEntry({
          field: "lastModified",
          oldValue: BASE_TS + 10,
          newValue: LOCAL_ITEM.lastModified,
        }),
      ]
    );
    await gotoCloudReady(page);

    const manifest = await acceptRemoteAndCaptureManifest(page, [
      {
        type: "modify",
        itemKey: ITEM_KEY,
        field: "lastModified",
        value: REMOTE_ITEM.lastModified,
      },
    ]);

    expect(manifest.changes.map((change) => change.itemKey)).not.toContain(ITEM_KEY);
  });

  test("AC-6: post-acceptance edits remain eligible for manifest upload", async ({ page }) => {
    await seedCloudState(page, [LOCAL_ITEM], [staleEntry()]);
    await gotoCloudReady(page);

    const manifest = await acceptRemoteAndCaptureManifest(page, selectedNameChange(), () =>
      page.evaluate(() => {
        window.logItemChanges(
          { ...window.inventory[0], name: "STRK-107 Remote" },
          { ...window.inventory[0], name: "STRK-107 Post Accept" }
        );
      })
    );
    const itemChange = manifest.changes.find((change) => change.itemKey === ITEM_KEY);

    expect(itemChange?.fields.map((field) => field.newValue)).toEqual(["STRK-107 Post Accept"]);
  });

  test("AC-2: accepted item does not produce a residual conflict on the opposite device", async ({
    page,
  }) => {
    await seedCloudState(page, [LOCAL_ITEM], [staleEntry()]);
    await gotoCloudReady(page);

    const manifest = await acceptRemoteAndCaptureManifest(page, selectedNameChange());
    const residualConflictKeys = manifest.changes
      .filter((change) => change.type === "edit")
      .map((change) => change.itemKey);

    expect(residualConflictKeys).not.toContain(ITEM_KEY);
  });

  test("AC-4: settings rollback does not neutralize local changelog entries", async ({ page }) => {
    await seedCloudState(page, [LOCAL_ITEM], [staleEntry()]);
    await gotoCloudReady(page);
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "appTheme") throw new Error("quota");
        return originalSetItem.call(this, key, value);
      };
      window.DiffModal.show = (options) => {
        options.onApply([
          { type: "modify", itemKey: "strk107-item", field: "name", value: "STRK-107 Remote" },
          { type: "setting", key: "appTheme", value: "dark" },
        ]);
        return Promise.resolve();
      };
    });

    await page.evaluate(
      (timestamp) =>
        window.showRestorePreviewModal(
          {
            added: [],
            deleted: [],
            unchanged: [],
            modified: [{ item: { ...window.inventory[0], name: "STRK-107 Remote" } }],
          },
          { changed: [{ key: "appTheme", remoteVal: "dark" }] },
          { data: { metalInventory: JSON.stringify([window.inventory[0]]) } },
          {
            syncId: "remote-sync",
            timestamp,
            rev: "remote-rev",
            itemCount: 1,
            deviceId: "remote-device",
          },
          null
        ),
      BASE_TS + 300
    );

    const entries = await page.evaluate(() => window.changeLog.filter((entry) => entry.itemKey));
    expect(entries).toHaveLength(1);
    expect(entries[0].neutralized).toBeFalsy();
    expect(await page.evaluate(() => window.inventory[0].name)).toBe(LOCAL_ITEM.name);
  });
});

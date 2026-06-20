import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const ACCOUNT_ID = "dbid:strk118-test-account";
const VAULT_PASSWORD = "strk118-test-password";
const SYNC_KEY = `${VAULT_PASSWORD}:${ACCOUNT_ID}`;
const BASE_TS = 1_700_000_000_000;
const ITEM_KEY = "strk118-sync-item";

const LOCAL_ITEM = {
  uuid: ITEM_KEY,
  serial: 118,
  metal: "Silver",
  composition: "Silver",
  name: "STRK-118 Local",
  qty: 1,
  type: "Round",
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 31,
  date: "2026-05-26",
  lastModified: BASE_TS + 20,
};

const REMOTE_ITEM = {
  ...LOCAL_ITEM,
  name: "STRK-118 Remote",
  lastModified: BASE_TS + 40,
};

const staleEntry = (overrides = {}) => ({
  timestamp: BASE_TS + 100,
  itemKey: ITEM_KEY,
  itemName: LOCAL_ITEM.name,
  type: "item-edit",
  field: "name",
  oldValue: "STRK-118 Original",
  newValue: LOCAL_ITEM.name,
  undone: false,
  ...overrides,
});

async function seedCloudState(page, inventory = [LOCAL_ITEM], changeLog = []) {
  await page.addInitScript(
    ({ accountId, password, inventorySeed, changeLogSeed, baseTs }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inventorySeed));
      localStorage.setItem("changeLog", JSON.stringify(changeLogSeed));
      localStorage.setItem("cloud_dropbox_account_id", accountId);
      localStorage.setItem("cloud_sync_enabled", "true");
      localStorage.setItem("cloud_sync_migrated", "v2");
      localStorage.setItem("cloud_vault_password", password);
      localStorage.setItem(
        "cloud_token_dropbox",
        JSON.stringify({
          access_token: "sl.strk118-test-token",
          expires_at: Date.now() + 3600000,
        })
      );
      localStorage.setItem(
        "cloud_sync_last_push",
        JSON.stringify({
          syncId: "local-before-acceptance",
          timestamp: baseTs,
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
      baseTs: BASE_TS,
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
    const path = dropboxPath(route);
    if (path.endsWith(".stmanifest") && options.manifestBytes) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(options.manifestBytes),
      });
      return;
    }
    // STRK-225: serve the image companion vault (checked before the sync vault —
    // both live under /sync/ but carry distinct ...-images / ...-sync suffixes).
    if (path.endsWith("staktrakr-images.stvault") && options.imageVaultBytes) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(options.imageVaultBytes),
      });
      return;
    }
    if (path.endsWith("staktrakr-sync.stvault") && options.vaultBytes) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(options.vaultBytes),
      });
      return;
    }
    // STRK-225: a 404 on the attachment vault still advances attachmentHash via
    // _pullAttachmentVault's not-found branch — a payload-free positive control.
    if (path.endsWith("staktrakr-attachments.stvault") && options.attachmentNotFound) {
      await route.fulfill({ status: 404, body: "{}" });
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
      body: JSON.stringify({ rev: "rev-strk118" }),
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

/**
 * Encrypts an arbitrary object as a StakTrakr .stvault file (salt|iv|iter|
 * ciphertext) under the composite sync key, runnable in-page so it uses the
 * app's exact crypto. Used by the STRK-225 vault-first test to serve a remote
 * main sync vault (`{ data: { metalInventory } }`) and image companion vault
 * (`{ records, patternRecords }`) that the in-app decrypt paths accept.
 */
async function encryptVaultPayload(page, payload) {
  return page.evaluate(
    async ({ data, key }) => {
      const iterations =
        typeof window.VAULT_PBKDF2_ITERATIONS !== "undefined"
          ? window.VAULT_PBKDF2_ITERATIONS
          : 600000;
      const salt = window.vaultRandomBytes(32);
      const iv = window.vaultRandomBytes(12);
      const derived = await window.vaultDeriveKey(key, salt, iterations);
      const plaintext = new TextEncoder().encode(JSON.stringify(data));
      const ciphertext = await window.vaultEncrypt(plaintext, derived, iv);
      return Array.from(
        new Uint8Array(window.serializeVaultFile(salt, iv, iterations, ciphertext))
      );
    },
    { data: payload, key: SYNC_KEY }
  );
}

test.describe("core/attachments-cloud", () => {
  test("trade received-side back-reference changes inventory hash", async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.computeInventoryHash === "function");

    const result = await page.evaluate(async () => {
      window.inventory = [
        {
          uuid: "strk123-sync-received",
          serial: 123,
          metal: "Silver",
          composition: "Silver",
          name: "STRK-123 Sync Received",
          qty: 1,
          type: "Round",
          weight: 1,
          weightUnit: "oz",
          purity: 0.999,
          price: 30,
          date: "2026-01-01",
        },
      ];
      const before = await window.computeInventoryHash(window.inventory);
      window.inventory[0].tradedFromUuid = "strk123-sync-source";
      const after = await window.computeInventoryHash(window.inventory);
      return { before, after };
    });

    expect(result.before).toBeTruthy();
    expect(result.after).toBeTruthy();
    expect(result.after).not.toBe(result.before);
  });

  test("Cloud settings tab and header button route to settings or manual sync based on config", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.showSettingsModal === "function");
    await page.evaluate(() => window.showSettingsModal("system"));
    await expect(page.locator("#settingsModal")).toBeVisible();

    await page.locator('[data-section="cloud"]').click();
    await expect(page.locator("#settingsPanel_cloud")).toBeVisible();
    await expect(page.locator("#settingsPanel_cloud #cloudCard_dropbox")).toBeVisible();
    await expect(page.locator("#settingsPanel_cloud")).toContainText("Cloud Sync Beta");

    await page.evaluate(() => {
      if (typeof window.hideSettingsModal === "function") window.hideSettingsModal();
      localStorage.removeItem("cloud_token_dropbox");
      localStorage.removeItem("cloud_vault_password");
      localStorage.removeItem("cloud_dropbox_account_id");
      localStorage.setItem("cloud_sync_enabled", "false");
      window.updateCloudSyncHeaderBtn?.();
    });
    await expect(page.locator("#settingsModal")).not.toBeVisible();
    await page.locator("#headerCloudSyncBtn").click();
    await expect(page.locator("#settingsPanel_cloud")).toBeVisible();

    await page.evaluate(() => {
      if (typeof window.hideSettingsModal === "function") window.hideSettingsModal();
      localStorage.setItem(
        "cloud_token_dropbox",
        JSON.stringify({ access_token: "test-token", expires_at: Date.now() + 60_000 })
      );
      localStorage.setItem("cloud_vault_password", "test-password");
      localStorage.setItem("cloud_dropbox_account_id", "acct:test");
      localStorage.setItem("cloud_sync_enabled", "true");
      window.__syncNowCalls = 0;
      window.syncNow = async () => {
        window.__syncNowCalls += 1;
        return { synced: true };
      };
      window.updateCloudSyncHeaderBtn?.();
    });
    await page.locator("#headerCloudSyncBtn").click();
    await expect.poll(() => page.evaluate(() => window.__syncNowCalls)).toBe(1);
  });

  test("sync attachment keys, defaults, and companion vault path remain sync-safe", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.ALLOWED_STORAGE_KEYS !== "undefined");

    const result = await page.evaluate(() => {
      const hasAllowedKey = (key) =>
        window.ALLOWED_STORAGE_KEYS instanceof Set
          ? window.ALLOWED_STORAGE_KEYS.has(key)
          : Array.isArray(window.ALLOWED_STORAGE_KEYS) && window.ALLOWED_STORAGE_KEYS.includes(key);

      localStorage.removeItem("syncAttachments");
      const defaultValue = window.loadDataSync("syncAttachments", null);
      window.saveDataSync("syncAttachments", false);
      const disabled = window.loadDataSync("syncAttachments", null);
      window.saveDataSync("syncAttachmentsWarnSeen", true);

      return {
        syncAttachmentsAllowed: hasAllowedKey("syncAttachments"),
        warningAllowed: hasAllowedKey("syncAttachmentsWarnSeen"),
        defaultEnabled: defaultValue === null || defaultValue === true || defaultValue === "true",
        disabled,
        warningSeen: window.loadDataSync("syncAttachmentsWarnSeen", null),
        suffix: window.VAULT_ATTACHMENT_FILE_SUFFIX,
        path: window.SYNC_ATTACHMENTS_PATH,
      };
    });

    expect(result).toMatchObject({
      syncAttachmentsAllowed: true,
      warningAllowed: true,
      defaultEnabled: true,
      disabled: false,
      warningSeen: true,
      suffix: "-attachments",
    });
    expect(result.path).toContain("-attachments");
    expect(result.path).toContain(".stvault");
  });

  test("AttachmentManager round-trips, cascades, exports, and reconciles records by UUID", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.attachmentManager !== "undefined");

    const result = await page.evaluate(async () => {
      await attachmentManager.init();
      await attachmentManager.addAttachment({
        attachmentUuid: "core-att-main",
        itemUuid: "core-item-main",
        fileName: "receipt.pdf",
        mimeType: "application/pdf",
        size: 1024,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        blob: new Blob(["receipt"], { type: "application/pdf" }),
      });
      await attachmentManager.addAttachment({
        attachmentUuid: "core-att-cascade",
        itemUuid: "core-item-main",
        fileName: "cascade.pdf",
        mimeType: "application/pdf",
        size: 512,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        blob: new Blob(["cascade"], { type: "application/pdf" }),
      });
      await attachmentManager.addAttachment({
        attachmentUuid: "core-att-orphan",
        itemUuid: "gone-item",
        fileName: "orphan.pdf",
        mimeType: "application/pdf",
        size: 128,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        blob: new Blob(["orphan"], { type: "application/pdf" }),
      });

      const fetched = await attachmentManager.getAttachment("core-att-main");
      const exported = await attachmentManager.exportAllAttachments();
      const hasStored = await attachmentManager.hasAttachment("core-att-main");
      const hasMissing = await attachmentManager.hasAttachment("missing-att");
      await attachmentManager.deleteAttachmentsForItem("core-item-main");
      const cascaded = await attachmentManager.getAttachmentsByItemUuid("core-item-main");
      const removed = await attachmentManager.reconcileOrphans(new Set());
      const orphanGone = await attachmentManager.hasAttachment("core-att-orphan");

      return {
        available: attachmentManager.isAvailable(),
        fetchedName: fetched?.fileName,
        fetchedBlob: fetched?.blob instanceof Blob,
        exportedHasRecord: exported.some((entry) => entry.attachmentUuid === "core-att-main"),
        hasStored,
        hasMissing,
        cascadedCount: cascaded.length,
        removed,
        orphanGone,
      };
    });

    expect(result).toMatchObject({
      available: true,
      fetchedName: "receipt.pdf",
      fetchedBlob: true,
      exportedHasRecord: true,
      hasStored: true,
      hasMissing: false,
      cascadedCount: 0,
      orphanGone: false,
    });
    expect(result.removed).toBeGreaterThanOrEqual(1);
  });

  test("attachment UI renders badges, lists, and conflict diff rows", async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.renderAttachmentBadge === "function" &&
        typeof window.renderAttachmentListPanel === "function" &&
        typeof window.renderAttachmentDiffRow === "function"
    );

    const result = await page.evaluate(async () => {
      const item = {
        attachments: [
          { attachmentUuid: "a1", fileName: "receipt.pdf", mimeType: "application/pdf", size: 10 },
          { attachmentUuid: "a2", fileName: "photo.jpg", mimeType: "image/jpeg", size: 20 },
        ],
      };
      const badge = renderAttachmentBadge(item);
      const emptyBadge = renderAttachmentBadge({ attachments: [] });
      const panel = await renderAttachmentListPanel(item, {});
      const diffRow = renderAttachmentDiffRow(
        {
          action: "replace",
          attachmentUuid: "a3",
          oldAttachmentUuid: "a1",
          fileName: "receipt-v2.pdf",
          localVal: { attachmentUuid: "a1", fileName: "receipt.pdf" },
          remoteVal: { attachmentUuid: "a3", fileName: "receipt-v2.pdf" },
        },
        "replaced"
      );
      return {
        badgeText: badge?.textContent || "",
        emptyBadge,
        panelText: panel?.textContent || "",
        diffHtml: diffRow?.outerHTML || "",
      };
    });

    expect(result.badgeText).toContain("2");
    expect(result.emptyBadge).toBeNull();
    expect(result.panelText).toContain("receipt.pdf");
    expect(result.diffHtml).toContain("receipt-v2.pdf");
  });

  test("DiffEngine detects attachment add/remove/replace changes and applies them idempotently", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.DiffEngine !== "undefined");

    const result = await page.evaluate(() => {
      const local = [
        { attachmentUuid: "keep", fileName: "keep.pdf", size: 100 },
        { attachmentUuid: "old-cert", fileName: "cert.pdf", size: 500 },
        { attachmentUuid: "remove", fileName: "remove.pdf", size: 200 },
      ];
      const remote = [
        { attachmentUuid: "keep", fileName: "keep.pdf", size: 100 },
        { attachmentUuid: "new-cert", fileName: "cert.pdf", size: 600 },
        { attachmentUuid: "add", fileName: "new.pdf", size: 300 },
      ];
      const diffs = DiffEngine.diffAttachments(local, remote);
      const inventory = [{ serial: 1, name: "Eagle", attachments: local }];
      const applied = DiffEngine.applySelectedChanges(
        inventory,
        diffs.map((diff) => ({
          type: "attach-entry",
          itemKey: "1",
          action: diff.action,
          attachmentUuid: diff.attachmentUuid,
          oldAttachmentUuid: diff.oldAttachmentUuid || null,
          value: diff.remoteVal,
        }))
      )[0].attachments;
      const duplicateAdd = DiffEngine.applySelectedChanges(
        [{ serial: 1, attachments: [{ attachmentUuid: "dup", fileName: "dup.pdf" }] }],
        [
          {
            type: "attach-entry",
            itemKey: "1",
            action: "add",
            attachmentUuid: "dup",
            value: { attachmentUuid: "dup", fileName: "dup.pdf" },
          },
        ]
      )[0].attachments;
      const compare = DiffEngine.compareItems(
        [{ uuid: "same", attachments: local }],
        [{ uuid: "same", attachments: remote }]
      );
      return {
        actions: diffs.map((diff) => diff.action).sort(),
        appliedUuids: applied.map((att) => att.attachmentUuid).sort(),
        duplicateCount: duplicateAdd.length,
        coarseChangeCount:
          compare.modified[0]?.changes.filter((change) => change.field === "attachments").length ||
          0,
      };
    });

    expect(result.actions).toEqual(["add", "remove", "replace"]);
    expect(result.appliedUuids).toEqual(["add", "keep", "new-cert"]);
    expect(result.duplicateCount).toBe(1);
    expect(result.coarseChangeCount).toBe(1);
  });

  test("cloud tag merge keeps per-item last-writer-wins and detects tag-only remotes", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("ackVersion", "9.9.9");
      localStorage.setItem("cloud_sync_enabled", "false");
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(() => {
      localStorage.setItem(
        "itemTags",
        JSON.stringify({ "remote-wins": ["Local old"], "local-wins": ["Local new"] })
      );
      localStorage.setItem("itemRemovedTags", JSON.stringify({ "remote-wins": ["Still removed"] }));
      localStorage.setItem(
        "itemTagsLastModified",
        JSON.stringify({ "remote-wins": 100, "local-wins": 300 })
      );
      window.loadItemTags?.();
      const remote = {
        itemTags: JSON.stringify({
          "remote-wins": ["Remote new"],
          "local-wins": ["Remote old"],
        }),
        itemRemovedTags: JSON.stringify({ "remote-wins": ["Remote new", "Still removed"] }),
        itemTagsLastModified: JSON.stringify({ "remote-wins": 200, "local-wins": 250 }),
      };
      const hasChanges = window.CloudSyncTest.hasTagChanges(remote);
      window.CloudSyncTest.mergeTagData(remote);
      return {
        hasChanges,
        tags: JSON.parse(localStorage.getItem("itemTags")),
        removed: JSON.parse(localStorage.getItem("itemRemovedTags")),
        memoryTags: window.getItemTags("remote-wins"),
      };
    });

    expect(result.hasChanges).toBe(true);
    expect(result.tags["remote-wins"]).toEqual(["Remote new"]);
    expect(result.tags["local-wins"]).toEqual(["Local new"]);
    expect(result.removed["remote-wins"]).toEqual(["Still removed"]);
    expect(result.memoryTags).toEqual(["Remote new"]);
  });

  test("manifest pull/push preserves normalized change types and vault fallback", async ({
    page,
  }) => {
    await seedCloudState(page);
    await gotoCloudReady(page);

    const manifestBytes = await encryptedManifest(page, {
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
    await routeDropbox(page, { manifestBytes });
    await page.evaluate(() => {
      window.__preview = null;
      window.DiffModal.show = (options) => {
        window.__preview = { diff: options.diff, conflicts: options.conflicts || null };
        options.onCancel?.();
        return Promise.resolve();
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

    const preview = await page.evaluate(() => window.__preview);
    expect(preview.diff.added.map((entry) => entry.itemKey)).toEqual(["add-key"]);
    expect(preview.diff.modified.map((entry) => entry.item.itemKey)).toEqual(["edit-key"]);
    expect(preview.diff.deleted.map((entry) => entry.itemKey)).toEqual(["delete-key"]);

    await page.unrouteAll();
    await routeDropbox(page);
    await page.evaluate(() => {
      window.__vaultDownloadAttempts = 0;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const arg = init?.headers?.["Dropbox-API-Arg"];
        if (arg && JSON.parse(arg).path?.endsWith(".stvault")) {
          window.__vaultDownloadAttempts += 1;
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
    expect(await page.evaluate(() => window.__vaultDownloadAttempts)).toBeGreaterThan(0);
  });

  test("accepting remote changes neutralizes stale local changelog entries before re-push", async ({
    page,
  }) => {
    let uploadedManifestBytes = null;
    await seedCloudState(page, [LOCAL_ITEM], [staleEntry()]);
    await routeDropbox(page, {
      onManifestUpload: async (bytes) => {
        uploadedManifestBytes = Array.from(bytes);
      },
    });
    await gotoCloudReady(page);
    await page.evaluate(() => {
      window.__applyCalls = 0;
      window.__neutralizeCalls = 0;
      const originalNeutralize = window.neutralizeSupersededChangelog;
      window.neutralizeSupersededChangelog = function () {
        window.__neutralizeCalls += 1;
        return originalNeutralize.apply(this, arguments);
      };
      window.DiffModal.show = (options) => {
        window.__applyCalls += 1;
        options.onApply([
          { type: "modify", itemKey: "strk118-sync-item", field: "name", value: "STRK-118 Remote" },
        ]);
        return Promise.resolve();
      };
    });

    await page.evaluate(
      ({ timestamp }) =>
        window.showRestorePreviewModal(
          {
            added: [],
            deleted: [],
            unchanged: [],
            modified: [
              {
                item: window.inventory[0],
                itemKey: "strk118-sync-item",
                fields: [
                  { field: "name", oldValue: "STRK-118 Local", newValue: "STRK-118 Remote" },
                ],
              },
            ],
          },
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
      { timestamp: BASE_TS + 300 }
    );

    await expect.poll(() => page.evaluate(() => window.__applyCalls)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__neutralizeCalls)).toBe(1);
    await expect.poll(() => uploadedManifestBytes, { timeout: 5000 }).not.toBeNull();
    const manifest = await page.evaluate(
      async ({ bytes, key }) => window.decryptManifest(new Uint8Array(bytes), key),
      { bytes: uploadedManifestBytes, key: SYNC_KEY }
    );
    expect(manifest.changes.map((change) => change.itemKey)).not.toContain(ITEM_KEY);
  });

  test("vault-first cancel does not advance the image/attachment hash, so a later accept still re-pulls (STRK-225)", async ({
    page,
  }) => {
    // STRK-225. The vault-first image-vault AND attachment-vault pulls
    // (cloud-sync.js) advanced lastPull.imageHash / lastPull.attachmentHash
    // regardless of whether the user APPLIED or CANCELLED the restore preview —
    // unlike the sibling item-price-history block, which STRK-147 already gated
    // on apply. On a cancel, STRK-200's membership guard skips the remote photos,
    // but the stale hash then blocks a later accept from re-pulling them. The fix
    // gates both companion pulls on apply.
    const REMOTE_IMG_HASH = "strk225-remote-image-hash";
    const REMOTE_ATTACH_HASH = "strk225-remote-attachment-hash";

    await seedCloudState(page);
    // Seed a prior pull WITHOUT an imageHash. The advance is guarded by
    // `if (_vfPullMeta)` (syncGetLastPull), so an ABSENT lastPull would short the
    // advance and give a false green — the object must exist, just lack imageHash.
    await page.addInitScript((baseTs) => {
      localStorage.setItem(
        "cloud_sync_last_pull",
        JSON.stringify({ syncId: "local-before-acceptance", timestamp: baseTs, rev: "rev-local" })
      );
    }, BASE_TS);
    await gotoCloudReady(page);

    // Remote main vault differs from local (name) → non-empty diff → execution
    // reaches the preview modal rather than the silent-pull early return.
    const vaultBytes = await encryptVaultPayload(page, {
      data: { metalInventory: JSON.stringify([REMOTE_ITEM]) },
    });
    // A valid (decryptable) image vault so the BUGGY code restores + advances the
    // hash; empty records keep the restore a no-op while still exercising the path.
    const imageVaultBytes = await encryptVaultPayload(page, { records: [], patternRecords: [] });
    // attachmentNotFound: the attachment vault 404s, which still advances
    // attachmentHash (not-found branch) without needing a valid payload.
    await routeDropbox(page, { vaultBytes, imageVaultBytes, attachmentNotFound: true });

    const remoteMeta = {
      syncId: "remote-sync-strk225",
      timestamp: BASE_TS + 5000,
      rev: "remote-rev-strk225",
      itemCount: 1,
      imageVault: { hash: REMOTE_IMG_HASH, imageCount: 0 },
      attachmentVault: { hash: REMOTE_ATTACH_HASH, attachmentCount: 0 },
    };

    const readHashes = () =>
      page.evaluate(() => {
        const lp = JSON.parse(localStorage.getItem("cloud_sync_last_pull") || "{}");
        return { imageHash: lp.imageHash || null, attachmentHash: lp.attachmentHash || null };
      });

    // CANCEL: the vault-first preview resolves false. Neither companion vault may
    // be pulled and neither watermark may advance.
    await page.evaluate((meta) => {
      window.showRestorePreviewModal = () => Promise.resolve(false);
      return window.pullWithPreview(meta);
    }, remoteMeta);

    const afterCancel = await readHashes();
    expect(afterCancel.imageHash).not.toBe(REMOTE_IMG_HASH);
    expect(afterCancel.attachmentHash).not.toBe(REMOTE_ATTACH_HASH);

    // ACCEPT (positive control): the same pull, now applied, DOES advance both
    // hashes — proving the gate doesn't break the normal re-pull path.
    await page.evaluate((meta) => {
      window.showRestorePreviewModal = () => Promise.resolve(true);
      return window.pullWithPreview(meta);
    }, remoteMeta);

    const afterAccept = await readHashes();
    expect(afterAccept.imageHash).toBe(REMOTE_IMG_HASH);
    expect(afterAccept.attachmentHash).toBe(REMOTE_ATTACH_HASH);
  });
});

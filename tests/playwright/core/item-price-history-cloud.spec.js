/**
 * STRK-147 — Cloud-sync item-price-history with UUID-aware merge (E2E)
 * =============================================================================
 * Cohort B.2 — E2E cloud-sync Playwright spec. This is a RED (TDD) cohort: the
 * item-price-history companion vault is NOT yet wired into js/cloud-sync.js
 * (that is Cohort C). Every test here encodes the INTENDED post-Cohort-C
 * behavior per the requirements/approach, so they MUST FAIL against current
 * code. Cohort C turns them green; do NOT edit source to make them pass.
 *
 * Decisions modeled (approach.md): the companion vault is modeled on the
 * always-on image vault (D-3), pushed to a dedicated .stvault path with a
 * `{hash, uuidCount, entryCount}` pointer on `metaPayload` (D-4/D-8), merged via
 * the pure commutative fingerprint-union `mergeItemPriceHistories()` from
 * Cohort A (D-2/D-6), with a throwing write path for partial-failure safety
 * (D-7), a debounced push trigger inside `saveItemPriceHistory()` (D-5), and a
 * poll hash-shortcut companion-hash branch so companion-only remote changes are
 * still detected and merged (D-11).
 *
 * Coverage map (test title → AC):
 *   - "two devices converge on the union of item-price-history entries
 *      and a re-sync is idempotent"                                 → AC-1 / AC-2
 *   - "history-only save schedules a debounced sync push when
 *      inventory is unchanged"                                      → AC-4
 *   - "poll hash-shortcut detects a companion-only remote change
 *      and merges before recording the pull"                        → AC-5 / D-11
 *   - "a companion-only remote pull merges silently without a
 *      diff modal"                                                  → AC-5
 *   - "a rejected remote Item imports no orphan price history"      → AC-6
 *   - "a quota/write failure leaves lastPull stale and records a
 *      partial state"                                               → AC-7
 *   - "the sync manifest/metadata carries only companion {hash,count}
 *      metadata, never full history JSON"                           → AC-8
 *
 * Mock/two-device structure mirrors tests/playwright/core/attachments-cloud.spec.js
 * (seedCloudState / routeDropbox / encrypted vault helpers / pull flow).
 */

import { test, expect } from "../helpers/mocks/extended-test.js";

const ACCOUNT_ID = "dbid:strk147-test-account";
const VAULT_PASSWORD = "strk147-test-password";
const SYNC_KEY = `${VAULT_PASSWORD}:${ACCOUNT_ID}`;
const BASE_TS = 1_700_000_000_000;

// Item-price-history is keyed by inventory item UUID (item.uuid is always a
// canonical RFC 4122 v4 UUID — see generateUUID in js/utils.js). The companion
// merge's canonicalizeItemPriceHistory() drops malformed-UUID keys by design
// (approach D-8), so these fixture keys MUST be canonical UUIDs, not slugs.
const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Use timestamps anchored to "now" so they survive the 365-day retention cap.
// LOCAL is 2h old, REMOTE is 1h old — both recent, both inside the window.
const NOW = Date.now();
const LOCAL_TS = NOW - 2 * 60 * 60 * 1000;
const REMOTE_TS = NOW - 1 * 60 * 60 * 1000;
const ORPHAN_TS = NOW - 30 * 60 * 1000;

const inventoryItem = (uuid, name, serial) => ({
  uuid,
  serial,
  metal: "Silver",
  composition: "Silver",
  name,
  qty: 1,
  type: "Round",
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 31,
  date: "2026-05-26",
  lastModified: BASE_TS + 20,
});

const LOCAL_INVENTORY = [inventoryItem(ITEM_A, "STRK-147 Local A", 147)];

// History entry factory — { ts, itemName, retail, spot, melt }.
const entry = (ts, overrides = {}) => ({
  ts,
  itemName: "STRK-147 Local A",
  retail: 33,
  spot: 30,
  melt: 29,
  ...overrides,
});

// Distinct local/remote entries for the same UUID — the union must keep BOTH.
const LOCAL_HISTORY = { [ITEM_A]: [entry(LOCAL_TS, { retail: 33 })] };
const REMOTE_HISTORY = { [ITEM_A]: [entry(REMOTE_TS, { retail: 35 })] };

/**
 * Seeds localStorage so the app boots already cloud-connected, optionally with
 * local inventory and item-price-history. Mirrors attachments-cloud.spec.js.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {Array}  [opts.inventory] - seed metalInventory
 * @param {object} [opts.history]   - seed item-price-history
 * @param {string} [opts.lastPullHistoryHash] - prior merged companion hash
 */
async function seedCloudState(page, opts = {}) {
  const inventory = opts.inventory || LOCAL_INVENTORY;
  const history = opts.history || {};
  await page.addInitScript(
    ({ accountId, password, inventorySeed, historySeed, baseTs, lastPullHistoryHash }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inventorySeed));
      localStorage.setItem("item-price-history", JSON.stringify(historySeed));
      localStorage.setItem("changeLog", JSON.stringify([]));
      localStorage.setItem("cloud_dropbox_account_id", accountId);
      localStorage.setItem("cloud_sync_enabled", "true");
      localStorage.setItem("cloud_sync_migrated", "v2");
      localStorage.setItem("cloud_vault_password", password);
      localStorage.setItem(
        "cloud_token_dropbox",
        JSON.stringify({
          access_token: "sl.strk147-test-token",
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
      localStorage.setItem(
        "cloud_sync_last_pull",
        JSON.stringify({
          syncId: "local-before-acceptance",
          timestamp: baseTs,
          rev: "rev-local",
          ...(lastPullHistoryHash ? { itemPriceHistoryHash: lastPullHistoryHash } : {}),
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
      historySeed: history,
      baseTs: BASE_TS,
      lastPullHistoryHash: opts.lastPullHistoryHash || null,
    }
  );
}

async function gotoCloudReady(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      // scheduleSyncPush is assigned only AFTER initSyncTabCoordination() claims
      // tab leadership, so waiting on it guarantees push/poll won't no-op on the
      // "not leader" guard.
      typeof window.scheduleSyncPush === "function" &&
      typeof window.pullWithPreview === "function" &&
      typeof window.pushSyncVault === "function" &&
      typeof window.pollForRemoteChanges === "function" &&
      typeof window.mergeItemPriceHistories === "function" &&
      typeof window.canonicalizeItemPriceHistory === "function" &&
      typeof window.collectAndHashItemPriceHistory === "function" &&
      typeof window.vaultEncryptItemPriceHistory === "function" &&
      typeof window.vaultDecryptItemPriceHistory === "function" &&
      typeof window.vaultDeriveKey === "function" &&
      typeof window.vaultEncrypt === "function" &&
      typeof window.vaultRandomBytes === "function" &&
      typeof window.serializeVaultFile === "function" &&
      typeof window.simpleHash === "function"
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

/**
 * Routes Dropbox content/api endpoints. Serves an encrypted metadata file at the
 * sync-meta path and an encrypted companion-vault file at the item-price-history
 * path, and records every upload so tests can assert push payloads.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {Uint8Array|number[]} [options.metaBytes] - encrypted metadata file
 * @param {Uint8Array|number[]} [options.historyVaultBytes] - encrypted companion vault
 * @param {(path:string,body:Buffer)=>void|Promise<void>} [options.onUpload]
 * @param {boolean} [options.historyUploadFails] - return 507 for companion upload
 */
async function routeDropbox(page, options = {}) {
  await page.route("https://content.dropboxapi.com/2/files/download", async (route) => {
    const path = dropboxPath(route);
    if (path.endsWith("staktrakr-sync.json") && options.metaBytes) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(options.metaBytes),
      });
      return;
    }
    if (path.endsWith("staktrakr-item-price-history.stvault") && options.historyVaultBytes) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(options.historyVaultBytes),
      });
      return;
    }
    await route.fulfill({ status: 409, body: "{}" });
  });

  await page.route("https://content.dropboxapi.com/2/files/upload", async (route) => {
    const path = dropboxPath(route);
    if (options.onUpload) {
      await options.onUpload(path, await route.request().postDataBuffer());
    }
    if (path.endsWith("staktrakr-item-price-history.stvault") && options.historyUploadFails) {
      await route.fulfill({ status: 507, body: "{}" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rev: "rev-strk147" }),
    });
  });

  await page.route("https://api.dropboxapi.com/2/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

/**
 * Encrypts a plain object as a StakTrakr vault file (salt|iv|iter|ciphertext)
 * decryptable by the in-app composite-key path (_tryDecryptMetadata / the
 * companion vault decrypt). Runs in-page so it uses the app's exact crypto.
 */
async function encryptVaultFile(page, payload) {
  return page.evaluate(
    async ({ data, key, iterations }) => {
      const salt = window.vaultRandomBytes(32);
      const iv = window.vaultRandomBytes(12);
      const derived = await window.vaultDeriveKey(key, salt, iterations);
      const plaintext = new TextEncoder().encode(JSON.stringify(data));
      const ciphertext = await window.vaultEncrypt(plaintext, derived, iv);
      const bytes = window.serializeVaultFile(salt, iv, iterations, ciphertext);
      return Array.from(new Uint8Array(bytes));
    },
    {
      data: payload,
      key: SYNC_KEY,
      iterations:
        (await page.evaluate(() =>
          typeof window.VAULT_PBKDF2_ITERATIONS !== "undefined"
            ? window.VAULT_PBKDF2_ITERATIONS
            : 600000
        )) || 600000,
    }
  );
}

/** Reads the persisted item-price-history from localStorage (decompressed/parsed). */
async function readPersistedHistory(page) {
  return page.evaluate(() => {
    const raw = window.loadDataSync ? window.loadDataSync("item-price-history", {}) : null;
    return raw && typeof raw === "object" ? raw : {};
  });
}

/** Computes the canonical companion hash for a history object, in-page. */
async function canonicalHash(page, history) {
  return page.evaluate((h) => {
    const canon = window.canonicalizeItemPriceHistory(h);
    return window.simpleHash(JSON.stringify(canon));
  }, history);
}

test.describe("core/item-price-history-cloud (STRK-147)", () => {
  test("two devices converge on the union of item-price-history entries and a re-sync is idempotent", async ({
    page,
  }) => {
    // AC-1 + AC-2. Local device holds one entry for ITEM_A; the remote companion
    // vault holds a DIFFERENT entry for the same UUID. After a pull the local
    // store must hold BOTH (union, never LWW). A second identical pull must not
    // change the stored history (idempotent / convergent).
    await seedCloudState(page, { inventory: LOCAL_INVENTORY, history: LOCAL_HISTORY });
    await gotoCloudReady(page);

    const remoteHash = await canonicalHash(page, REMOTE_HISTORY);
    const metaBytes = await encryptVaultFile(page, {
      syncId: "remote-sync-1",
      timestamp: BASE_TS + 5000,
      rev: "remote-rev-1",
      deviceId: "remote-device",
      itemCount: LOCAL_INVENTORY.length,
      manifestVersion: 2,
      // Inventory + settings unchanged remotely; ONLY the companion differs.
      itemPriceHistoryVault: { hash: remoteHash, uuidCount: 1, entryCount: 1 },
    });
    const historyVaultBytes = await encryptVaultFile(page, REMOTE_HISTORY);
    await routeDropbox(page, { metaBytes, historyVaultBytes });

    // Suppress any diff modal — companion-only merges must be silent (AC-5).
    await page.evaluate(() => {
      if (window.DiffModal) window.DiffModal.show = () => Promise.resolve();
    });

    await page.evaluate(() => window.pollForRemoteChanges());

    const afterFirst = await readPersistedHistory(page);
    const tsAfterFirst = (afterFirst[ITEM_A] || []).map((e) => e.ts);
    // Union must hold BOTH the local and remote entries (LWW would keep only one).
    expect(tsAfterFirst).toContain(LOCAL_TS);
    expect(tsAfterFirst).toContain(REMOTE_TS);

    // Second pull, same remote — must be a no-op (idempotent / convergent).
    await page.evaluate(() => window.pollForRemoteChanges());
    const afterSecond = await readPersistedHistory(page);
    expect(afterSecond).toEqual(afterFirst);
  });

  test("history-only save schedules a debounced sync push when inventory is unchanged", async ({
    page,
  }) => {
    // AC-4. Recording price history (saveItemPriceHistory) with inventory
    // otherwise unchanged must schedule a debounced push (D-5).
    await seedCloudState(page, { inventory: LOCAL_INVENTORY, history: {} });
    await gotoCloudReady(page);

    const result = await page.evaluate(async () => {
      let calls = 0;
      window.scheduleSyncPush = () => {
        calls += 1;
      };
      // D-5 wires the debounced push trigger inside saveItemPriceHistory(); for
      // that to be exercisable it must be reachable. A history-only save (no
      // inventory change) must schedule a push.
      const hasSaveFn = typeof window.saveItemPriceHistory === "function";
      if (hasSaveFn) {
        // Mutate ONLY history, not inventory, then persist via the app path.
        const hist = window.loadDataSync("item-price-history", {});
        hist["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] = [
          { ts: Date.now(), itemName: "STRK-147 Local A", retail: 40, spot: 31, melt: 30 },
        ];
        window.saveDataSync("item-price-history", hist);
        window.saveItemPriceHistory();
      }
      return { hasSaveFn, calls };
    });

    // Both halves of the AC-4 contract: the save path is reachable AND it
    // schedules a debounced push when only history changed.
    expect(result.hasSaveFn).toBe(true);
    expect(result.calls).toBeGreaterThan(0);
  });

  test("poll hash-shortcut detects a companion-only remote change and merges before recording the pull", async ({
    page,
  }) => {
    // AC-5 / D-11. When inventory + settings hashes MATCH, the poll fast-path
    // short-returns today (cloud-sync.js:2474-2483). It must instead compare the
    // companion hash and route to a silent merge BEFORE syncSetLastPull when only
    // item-price-history changed remotely.
    await seedCloudState(page, { inventory: LOCAL_INVENTORY, history: LOCAL_HISTORY });
    await gotoCloudReady(page);

    // Build remote meta whose inventory + settings hashes MATCH local, but whose
    // companion hash differs.
    const remoteHash = await canonicalHash(page, REMOTE_HISTORY);
    const { invHash, setHash } = await page.evaluate(async () => {
      const inv = typeof inventory !== "undefined" ? inventory : [];
      return {
        invHash: await window.computeInventoryHash(inv),
        setHash: await window.computeSettingsHash(),
      };
    });
    const metaBytes = await encryptVaultFile(page, {
      syncId: "remote-sync-companion-only",
      timestamp: BASE_TS + 6000,
      rev: "remote-rev-companion",
      deviceId: "remote-device",
      itemCount: LOCAL_INVENTORY.length,
      manifestVersion: 2,
      inventoryHash: invHash,
      settingsHash: setHash,
      itemPriceHistoryVault: { hash: remoteHash, uuidCount: 1, entryCount: 1 },
    });
    const historyVaultBytes = await encryptVaultFile(page, REMOTE_HISTORY);
    await routeDropbox(page, { metaBytes, historyVaultBytes });
    await page.evaluate(() => {
      if (window.DiffModal) window.DiffModal.show = () => Promise.resolve();
    });

    await page.evaluate(() => window.pollForRemoteChanges());

    // The remote-only entry must now be merged locally (not silently dropped).
    const merged = await readPersistedHistory(page);
    const ts = (merged[ITEM_A] || []).map((e) => e.ts);
    expect(ts).toContain(LOCAL_TS);
    expect(ts).toContain(REMOTE_TS);

    // lastPull must record the merged companion hash so the next poll is a no-op.
    const lastPullHash = await page.evaluate(() => {
      const lp = JSON.parse(localStorage.getItem("cloud_sync_last_pull") || "{}");
      return lp.itemPriceHistoryHash || null;
    });
    const mergedHash = await canonicalHash(page, merged);
    expect(lastPullHash).toBe(mergedHash);
  });

  test("a companion-only remote pull merges silently without a diff modal", async ({ page }) => {
    // AC-5. A remote pull that differs only in companion-vault metadata must
    // merge without ever presenting an item/settings diff modal.
    await seedCloudState(page, { inventory: LOCAL_INVENTORY, history: LOCAL_HISTORY });
    await gotoCloudReady(page);

    const remoteHash = await canonicalHash(page, REMOTE_HISTORY);
    const { invHash, setHash } = await page.evaluate(async () => {
      const inv = typeof inventory !== "undefined" ? inventory : [];
      return {
        invHash: await window.computeInventoryHash(inv),
        setHash: await window.computeSettingsHash(),
      };
    });
    const metaBytes = await encryptVaultFile(page, {
      syncId: "remote-sync-silent",
      timestamp: BASE_TS + 7000,
      rev: "remote-rev-silent",
      deviceId: "remote-device",
      itemCount: LOCAL_INVENTORY.length,
      manifestVersion: 2,
      inventoryHash: invHash,
      settingsHash: setHash,
      itemPriceHistoryVault: { hash: remoteHash, uuidCount: 1, entryCount: 1 },
    });
    const historyVaultBytes = await encryptVaultFile(page, REMOTE_HISTORY);
    await routeDropbox(page, { metaBytes, historyVaultBytes });

    const diffShown = await page.evaluate(async () => {
      let shown = false;
      if (window.DiffModal) {
        window.DiffModal.show = () => {
          shown = true;
          return Promise.resolve();
        };
      }
      await window.pollForRemoteChanges();
      return shown;
    });

    expect(diffShown).toBe(false);
    const merged = await readPersistedHistory(page);
    const ts = (merged[ITEM_A] || []).map((e) => e.ts);
    expect(ts).toContain(LOCAL_TS);
    expect(ts).toContain(REMOTE_TS);
  });

  test("a rejected remote Item imports no orphan price history", async ({ page }) => {
    // AC-6. The remote companion vault carries history for ITEM_B, but ITEM_B is
    // NOT accepted into the local inventory boundary. Its history must NOT be
    // imported (filtered to accepted UUIDs).
    await seedCloudState(page, { inventory: LOCAL_INVENTORY, history: LOCAL_HISTORY });
    await gotoCloudReady(page);

    const remoteHistory = {
      [ITEM_A]: [entry(REMOTE_TS, { retail: 35 })],
      [ITEM_B]: [entry(ORPHAN_TS, { itemName: "STRK-147 Rejected B", retail: 99 })],
    };
    const remoteHash = await canonicalHash(page, remoteHistory);
    const metaBytes = await encryptVaultFile(page, {
      syncId: "remote-sync-orphan",
      timestamp: BASE_TS + 8000,
      rev: "remote-rev-orphan",
      deviceId: "remote-device",
      itemCount: LOCAL_INVENTORY.length,
      manifestVersion: 2,
      itemPriceHistoryVault: { hash: remoteHash, uuidCount: 2, entryCount: 2 },
    });
    const historyVaultBytes = await encryptVaultFile(page, remoteHistory);
    await routeDropbox(page, { metaBytes, historyVaultBytes });
    await page.evaluate(() => {
      if (window.DiffModal) window.DiffModal.show = () => Promise.resolve();
    });

    await page.evaluate(() => window.pollForRemoteChanges());

    const merged = await readPersistedHistory(page);
    // ITEM_A's history merged (accepted), ITEM_B's left out (rejected/orphan).
    const tsA = (merged[ITEM_A] || []).map((e) => e.ts);
    expect(tsA).toContain(LOCAL_TS);
    expect(tsA).toContain(REMOTE_TS);
    expect(merged[ITEM_B]).toBeUndefined();
  });

  test("a quota/write failure leaves lastPull stale and records a partial state", async ({
    page,
  }) => {
    // AC-7. If the companion-history merge write fails (e.g. quota), lastPull
    // must NOT advance to the remote syncId, so the next poll retries.
    await seedCloudState(page, { inventory: LOCAL_INVENTORY, history: LOCAL_HISTORY });
    await gotoCloudReady(page);

    // Companion-only remote change (inv + settings hashes MATCH) so the silent
    // companion merge path is the one that must run — and fail on the write.
    const remoteHash = await canonicalHash(page, REMOTE_HISTORY);
    const { invHash, setHash } = await page.evaluate(async () => {
      const inv = typeof inventory !== "undefined" ? inventory : [];
      return {
        invHash: await window.computeInventoryHash(inv),
        setHash: await window.computeSettingsHash(),
      };
    });
    const metaBytes = await encryptVaultFile(page, {
      syncId: "remote-sync-quota",
      timestamp: BASE_TS + 9000,
      rev: "remote-rev-quota",
      deviceId: "remote-device",
      itemCount: LOCAL_INVENTORY.length,
      manifestVersion: 2,
      inventoryHash: invHash,
      settingsHash: setHash,
      itemPriceHistoryVault: { hash: remoteHash, uuidCount: 1, entryCount: 1 },
    });
    const historyVaultBytes = await encryptVaultFile(page, REMOTE_HISTORY);
    await routeDropbox(page, { metaBytes, historyVaultBytes });

    const lastPullBefore = await page.evaluate(
      () => JSON.parse(localStorage.getItem("cloud_sync_last_pull") || "{}").syncId
    );

    const writeAttempted = await page.evaluate(async () => {
      if (window.DiffModal) window.DiffModal.show = () => Promise.resolve();
      // Force the strict companion write (D-7) to throw (simulate quota). Spy so
      // we can prove the companion merge path actually attempted the write.
      let attempts = 0;
      window.writeItemPriceHistoryStrict = () => {
        attempts += 1;
        throw new Error("QuotaExceededError");
      };
      await window.pollForRemoteChanges();
      return attempts;
    });

    const lastPullAfter = await page.evaluate(
      () => JSON.parse(localStorage.getItem("cloud_sync_last_pull") || "{}").syncId
    );

    // The companion merge path must run the strict (throwing) write (D-7)...
    expect(writeAttempted).toBeGreaterThan(0);
    // ...and on that failure, lastPull must NOT advance to the remote syncId, so
    // the next poll retries (AC-7).
    expect(lastPullAfter).toBe(lastPullBefore);
    expect(lastPullAfter).not.toBe("remote-sync-quota");
  });

  test("the sync manifest/metadata carries only companion {hash,count} metadata, never full history JSON", async ({
    page,
  }) => {
    // AC-8. On push, the metaPayload must gain an `itemPriceHistoryVault` pointer
    // with only {hash, uuidCount, entryCount} — and never the full history JSON
    // (which rides the separate encrypted .stvault companion file).
    await seedCloudState(page, { inventory: LOCAL_INVENTORY, history: LOCAL_HISTORY });
    await gotoCloudReady(page);

    const uploads = [];
    await routeDropbox(page, {
      onUpload: (path, body) => {
        uploads.push({ path, body: Array.from(body) });
      },
    });

    await page.evaluate(() => window.pushSyncVault());

    const metaUpload = uploads.find((u) => u.path.endsWith("staktrakr-sync.json"));
    expect(metaUpload, "a sync-meta file must be uploaded").toBeTruthy();

    // Decrypt the uploaded metadata and inspect the companion pointer.
    const meta = await page.evaluate(
      async ({ bytes, key }) => {
        const parsed = window.parseVaultFile(new Uint8Array(bytes));
        const derived = await window.vaultDeriveKey(key, parsed.salt, parsed.iterations);
        const plain = await window.vaultDecrypt(parsed.ciphertext, derived, parsed.iv);
        return JSON.parse(new TextDecoder().decode(plain));
      },
      { bytes: metaUpload.body, key: SYNC_KEY }
    );

    expect(meta.itemPriceHistoryVault).toBeTruthy();
    expect(typeof meta.itemPriceHistoryVault.hash).toBe("string");
    expect(Object.keys(meta.itemPriceHistoryVault).sort()).toEqual([
      "entryCount",
      "hash",
      "uuidCount",
    ]);

    // The full history JSON must NOT appear anywhere in the metadata payload.
    const metaJson = JSON.stringify(meta);
    expect(metaJson).not.toContain("itemName");
    expect(metaJson).not.toContain(String(LOCAL_TS));

    // A dedicated companion .stvault file must be uploaded (history rides there).
    const companionUpload = uploads.find((u) =>
      u.path.endsWith("staktrakr-item-price-history.stvault")
    );
    expect(companionUpload, "a companion item-price-history vault must be uploaded").toBeTruthy();
  });
});

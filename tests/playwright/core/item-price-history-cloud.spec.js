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
import { encryptVaultPayload } from "../helpers/vault-fixtures.js";

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
    // STRK-224: manifest-first path fixture (.stmanifest routes pullWithPreview
    // through _deferredVaultRestore — the Edge-3 manifest-first site).
    if (path.endsWith(".stmanifest") && options.manifestBytes) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(options.manifestBytes),
      });
      return;
    }
    if (path.endsWith("staktrakr-item-price-history.stvault")) {
      // STRK-224 (Edge 2): force a transient companion download failure so the
      // pull returns the non-throwing {hash:null} shape.
      if (options.historyDownloadStatus) {
        await route.fulfill({ status: options.historyDownloadStatus, body: "{}" });
        return;
      }
      if (options.historyVaultBytes) {
        await route.fulfill({
          status: 200,
          contentType: "application/octet-stream",
          body: Buffer.from(options.historyVaultBytes),
        });
        return;
      }
    }
    // STRK-224: main sync vault fixture (.stvault) so the vault-first /
    // manifest-first apply paths can decrypt + diff and reach the DiffModal.
    if (path.endsWith("staktrakr-sync.stvault") && options.vaultBytes) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from(options.vaultBytes),
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

/** Computes the current local inventory + settings hashes (for companion-only metas). */
async function computeLocalHashes(page) {
  return page.evaluate(async () => {
    const inv = typeof inventory !== "undefined" ? inventory : [];
    return {
      invHash: await window.computeInventoryHash(inv),
      setHash: await window.computeSettingsHash(),
    };
  });
}

/** Replaces DiffModal.show with a resolved no-op so companion merges stay silent. */
async function suppressDiffModal(page) {
  await page.evaluate(() => {
    if (window.DiffModal) window.DiffModal.show = () => Promise.resolve();
  });
}

/**
 * Builds an encrypted remote sync-metadata file carrying a companion pointer.
 * Defaults supply the common manifest-v2 + companion-vault shape; `overrides`
 * shallow-merge on top (e.g. syncId, inventoryHash, settingsHash, itemCount).
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {string} [opts.companionHash] - companion-vault hash for the pointer
 * @param {object} [opts.pointer] - companion pointer override ({hash,uuidCount,entryCount})
 * @param {object} [opts.overrides] - additional/overriding top-level meta fields
 * @returns {Promise<number[]>} encrypted metadata file bytes
 */
async function buildRemoteMeta(page, opts = {}) {
  const pointer = opts.pointer || {
    hash: opts.companionHash,
    uuidCount: 1,
    entryCount: 1,
  };
  return encryptVaultPayload(
    page,
    {
      syncId: "remote-sync",
      timestamp: BASE_TS + 5000,
      rev: "remote-rev",
      deviceId: "remote-device",
      itemCount: LOCAL_INVENTORY.length,
      manifestVersion: 2,
      itemPriceHistoryVault: pointer,
      ...(opts.overrides || {}),
    },
    SYNC_KEY
  );
}

/**
 * Seeds the remote companion: computes the companion hash for `history`, builds
 * the remote metadata (companion pointer + any `metaOverrides`), encrypts the
 * companion vault, wires routeDropbox, and (unless `keepDiffModal`) suppresses
 * the diff modal. Replaces the per-test push/meta/historyVault/route/suppress
 * boilerplate (STRK-147 Codacy duplication gate).
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {object} [opts.history] - remote companion history (default REMOTE_HISTORY)
 * @param {object} [opts.pointer] - explicit companion pointer override
 * @param {object} [opts.metaOverrides] - extra/overriding meta fields
 * @param {object} [opts.routeOptions] - extra routeDropbox options (e.g. onUpload)
 * @param {boolean} [opts.keepDiffModal] - skip the DiffModal suppression
 * @returns {Promise<{remoteHash:string}>} the computed companion hash
 */
async function seedRemoteCompanion(page, opts = {}) {
  const history = opts.history || REMOTE_HISTORY;
  const remoteHash = await canonicalHash(page, history);
  const metaBytes = await buildRemoteMeta(page, {
    companionHash: remoteHash,
    pointer: opts.pointer,
    overrides: opts.metaOverrides,
  });
  const historyVaultBytes = await encryptVaultPayload(page, history, SYNC_KEY);
  await routeDropbox(page, { metaBytes, historyVaultBytes, ...(opts.routeOptions || {}) });
  if (!opts.keepDiffModal) await suppressDiffModal(page);
  return { remoteHash };
}

/** Encrypts a manifest payload for the manifest-first pull fixture (STRK-224). */
async function encryptedManifest(page, manifest) {
  return page.evaluate(
    async ({ payload, key }) =>
      Array.from(new Uint8Array(await window.encryptManifest(payload, key))),
    { payload: manifest, key: SYNC_KEY }
  );
}

// A remote main-vault inventory that DIFFERS from local (name) so the apply
// paths compute a non-empty diff and reach the DiffModal rather than the
// silent-pull early return (STRK-224 Edge-1/Edge-3 fixtures).
const REMOTE_ITEM_DIFF = inventoryItem(ITEM_A, "STRK-224 Remote A", 147);

// --- STRK-224 shared test helpers (keeps the edge cases below clone-free) ----

/** seedCloudState + gotoCloudReady — the boot pair every cloud test runs. */
async function bootSynced(page, opts) {
  await seedCloudState(page, opts || { inventory: LOCAL_INVENTORY, history: LOCAL_HISTORY });
  await gotoCloudReady(page);
}

/** Reads the persisted `lastPull` object (null when unset). */
function readLastPull(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("cloud_sync_last_pull") || "null"));
}

/** Timestamps of the persisted item-price-history entries for ITEM_A. */
async function historyTsForItemA(page) {
  const h = await readPersistedHistory(page);
  return (h[ITEM_A] || []).map((e) => e.ts);
}

/**
 * Drives an apply-path pull: stubs `DiffModal.show` to APPLY via `onApply([])` (which
 * runs the REAL apply path — `_applyAndFinalize` for vault-first, `_deferredVaultRestore`
 * for manifest-first), optionally forcing the post-apply companion write to throw.
 * Returns the number of write attempts.
 */
function pullApplying(page, meta, { throwWrite = false } = {}) {
  return page.evaluate(
    async ({ m, doThrow }) => {
      let attempts = 0;
      window.__realWrite = window.__realWrite || window.writeItemPriceHistoryStrict;
      window.writeItemPriceHistoryStrict = doThrow
        ? () => {
            attempts += 1;
            throw new Error("QuotaExceededError");
          }
        : window.__realWrite;
      window.DiffModal.show = (options) => {
        options.onApply([]);
        return Promise.resolve();
      };
      await window.pullWithPreview(m);
      return attempts;
    },
    { m: meta, doThrow: throwWrite }
  );
}

/**
 * Edge-3 scenario shared by manifest-first and vault-first: a post-apply companion
 * write-throw must leave the prior `lastPull` intact (no `syncId` advance), and a
 * healthy retry must merge. A `manifest` spec routes through `_deferredVaultRestore`;
 * omitting it falls through to the vault-first path.
 */
async function expectWriteThrowRetries(page, { manifest, syncId } = {}) {
  await bootSynced(page);
  const manifestBytes = manifest ? await encryptedManifest(page, manifest) : undefined;
  const remoteHash = await canonicalHash(page, REMOTE_HISTORY);
  const remoteInventory = manifestBytes ? LOCAL_INVENTORY : [REMOTE_ITEM_DIFF];
  const vaultBytes = await encryptVaultPayload(
    page,
    { data: { metalInventory: JSON.stringify(remoteInventory) } },
    SYNC_KEY
  );
  const historyVaultBytes = await encryptVaultPayload(page, REMOTE_HISTORY, SYNC_KEY);
  await routeDropbox(page, {
    ...(manifestBytes ? { manifestBytes } : {}),
    vaultBytes,
    historyVaultBytes,
  });
  const remoteMeta = {
    syncId,
    timestamp: BASE_TS + 5000,
    rev: `${syncId}-rev`,
    deviceId: "remote-device",
    itemCount: LOCAL_INVENTORY.length,
    itemPriceHistoryVault: { hash: remoteHash, uuidCount: 1, entryCount: 1 },
  };

  // Apply with a throwing post-apply companion write → prior lastPull intact.
  expect(await pullApplying(page, remoteMeta, { throwWrite: true })).toBeGreaterThan(0);
  const afterFail = await readLastPull(page);
  expect(afterFail.syncId).toBe("local-before-acceptance");
  expect(afterFail.itemPriceHistoryHash || null).toBeNull();

  // Retry with the healthy write restored → companion merges.
  await pullApplying(page, remoteMeta, { throwWrite: false });
  const ts = await historyTsForItemA(page);
  expect(ts).toContain(LOCAL_TS);
  expect(ts).toContain(REMOTE_TS);
}

test.describe("core/item-price-history-cloud (STRK-147)", () => {
  test("two devices converge on the union of item-price-history entries and a re-sync is idempotent", async ({
    page,
  }) => {
    // AC-1 + AC-2. Local device holds one entry for ITEM_A; the remote companion
    // vault holds a DIFFERENT entry for the same UUID. After a pull the local
    // store must hold BOTH (union, never LWW). A second identical pull must not
    // change the stored history (idempotent / convergent).
    await bootSynced(page);

    // Inventory + settings unchanged remotely; ONLY the companion differs. The
    // diff modal is suppressed so the companion-only merge stays silent (AC-5).
    // STRK-224: a matching inventoryHash (and no settingsHash → settingsMatch
    // defaults true) drives the poll's silent fast-path, where the companion
    // merge now lives after the Edge-1 reorder removed the unconditional pre-merge.
    const { invHash } = await computeLocalHashes(page);
    await seedRemoteCompanion(page, {
      metaOverrides: { syncId: "remote-sync-1", rev: "remote-rev-1", inventoryHash: invHash },
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
    await bootSynced(page);

    // Build remote meta whose inventory hash MATCHES local. STRK-224: omit
    // settingsHash so settingsMatch defaults true (the companion merge now lives
    // on the silent fast-path after the Edge-1 reorder).
    const { invHash } = await computeLocalHashes(page);
    await seedRemoteCompanion(page, {
      metaOverrides: {
        syncId: "remote-sync-companion-only",
        rev: "remote-rev-companion",
        inventoryHash: invHash,
      },
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
    await bootSynced(page);

    // STRK-224: matching inventoryHash, no settingsHash → settingsMatch defaults
    // true so the poll takes the silent fast-path (no DiffModal).
    const { invHash } = await computeLocalHashes(page);
    // keepDiffModal: this test installs its OWN DiffModal.show spy below to prove
    // the modal is never shown, so the default suppression must be skipped.
    await seedRemoteCompanion(page, {
      keepDiffModal: true,
      metaOverrides: {
        syncId: "remote-sync-silent",
        rev: "remote-rev-silent",
        inventoryHash: invHash,
      },
    });

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
    await bootSynced(page);

    const remoteHistory = {
      [ITEM_A]: [entry(REMOTE_TS, { retail: 35 })],
      [ITEM_B]: [entry(ORPHAN_TS, { itemName: "STRK-147 Rejected B", retail: 99 })],
    };
    const orphanHash = await canonicalHash(page, remoteHistory);
    // STRK-224: matching inventoryHash (no settingsHash) routes the poll through
    // the silent fast-path where the companion merge lives after the Edge-1 reorder.
    const { invHash } = await computeLocalHashes(page);
    await seedRemoteCompanion(page, {
      history: remoteHistory,
      metaOverrides: {
        syncId: "remote-sync-orphan",
        rev: "remote-rev-orphan",
        inventoryHash: invHash,
      },
      // The companion holds two UUIDs (ITEM_A accepted, ITEM_B rejected).
      pointer: { hash: orphanHash, uuidCount: 2, entryCount: 2 },
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
    await bootSynced(page);

    // Companion-only remote change (matching inventoryHash; STRK-224: no
    // settingsHash → settingsMatch defaults true) so the silent companion merge
    // path is the one that must run — and fail on the write.
    const { invHash } = await computeLocalHashes(page);
    await seedRemoteCompanion(page, {
      metaOverrides: {
        syncId: "remote-sync-quota",
        rev: "remote-rev-quota",
        inventoryHash: invHash,
      },
    });

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
    await bootSynced(page);

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

  // ===========================================================================
  // STRK-224 — companion failure/cancel/retry edges (deferred from STRK-147)
  // ===========================================================================

  test("Edge 1: cancelling a DiffModal that also carries a companion change does not merge or record it (STRK-224)", async ({
    page,
  }) => {
    // AC-1 / AC-2 / AC-9(a). A poll detects a remote sync with BOTH an inventory
    // change (forces the DiffModal) AND an item-price-history companion change.
    // Cancelling the modal must NOT merge the companion history nor advance
    // lastPull.itemPriceHistoryHash / syncId. FAILS today because the poll
    // pre-merges the companion (cloud-sync.js:2545) before the modal is shown.
    await bootSynced(page);

    const remoteHash = await canonicalHash(page, REMOTE_HISTORY);
    // inventoryHash is deliberately NON-matching so the poll skips the silent
    // fast-path and routes to handleRemoteChange → pullWithPreview (the modal).
    const metaBytes = await buildRemoteMeta(page, {
      companionHash: remoteHash,
      overrides: {
        syncId: "remote-sync-cancel",
        rev: "remote-rev-cancel",
        inventoryHash: "strk224-nonmatching-inventory-hash",
      },
    });
    const vaultBytes = await encryptVaultPayload(
      page,
      { data: { metalInventory: JSON.stringify([REMOTE_ITEM_DIFF]) } },
      SYNC_KEY
    );
    const historyVaultBytes = await encryptVaultPayload(page, REMOTE_HISTORY, SYNC_KEY);
    await routeDropbox(page, { metaBytes, vaultBytes, historyVaultBytes });

    // CANCEL the restore preview (vault-first resolves false on cancel).
    await page.evaluate(async () => {
      window.showRestorePreviewModal = () => Promise.resolve(false);
      await window.pollForRemoteChanges();
    });

    // The remote companion entry must NOT be merged...
    const after = await readPersistedHistory(page);
    const ts = (after[ITEM_A] || []).map((e) => e.ts);
    expect(ts).toContain(LOCAL_TS);
    expect(ts).not.toContain(REMOTE_TS);
    // ...and neither the companion hash nor the syncId may advance.
    const lastPull = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cloud_sync_last_pull") || "{}")
    );
    expect(lastPull.itemPriceHistoryHash || null).toBeNull();
    expect(lastPull.syncId).toBe("local-before-acceptance");
  });

  test("Edge 1 guard: a companion-only change still merges silently and records its hash (STRK-224 non-regression)", async ({
    page,
  }) => {
    // AC-3 / AC-9. Non-regression guard for the STRK-147 D-11 silent fast-path: a
    // remote sync carrying ONLY a companion change (inventory + settings hashes
    // match → no DiffModal) must still merge silently and advance
    // lastPull.itemPriceHistoryHash. Expected GREEN before AND after Cohort C — it
    // goes RED only if C.3's reorder regresses the silent merge.
    await bootSynced(page);

    const { invHash } = await computeLocalHashes(page);
    // Companion-only: matching inventoryHash, no settingsHash → settingsMatch
    // defaults true so the silent fast-path is taken (the path the companion
    // merge lives on after C.3) without coupling to settings-hash timing.
    await seedRemoteCompanion(page, {
      metaOverrides: {
        syncId: "remote-sync-companion-guard",
        rev: "remote-rev-companion-guard",
        inventoryHash: invHash,
      },
    });

    await page.evaluate(() => window.pollForRemoteChanges());

    const merged = await readPersistedHistory(page);
    const ts = (merged[ITEM_A] || []).map((e) => e.ts);
    expect(ts).toContain(LOCAL_TS);
    expect(ts).toContain(REMOTE_TS);
    const lastPullHash = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("cloud_sync_last_pull") || "{}").itemPriceHistoryHash ||
        null
    );
    expect(lastPullHash).toBe(await canonicalHash(page, merged));
  });

  test("Edge 2: a transient companion download failure holds lastPull stale and retries on the next poll (STRK-224)", async ({
    page,
  }) => {
    // AC-4 / AC-6 / AC-9(b). A companion-only remote change (matching inv +
    // settings hashes) whose companion download transiently fails returns the
    // non-throwing {hash:null} shape. The poll must NOT advance lastPull.syncId or
    // itemPriceHistoryHash, and a later healthy poll must merge. FAILS today
    // because the null-hash return is treated as non-failed and the watermark
    // advances, tripping the same-syncId shortcut on the retry.
    await bootSynced(page);

    const remoteHash = await canonicalHash(page, REMOTE_HISTORY);
    const { invHash } = await computeLocalHashes(page);
    // Companion-only change: matching inventoryHash, and NO settingsHash so the
    // poll's settingsMatch defaults true (backward-compat) → the silent fast-path
    // is reached deterministically without coupling to settings-hash timing.
    const metaBytes = await buildRemoteMeta(page, {
      companionHash: remoteHash,
      overrides: {
        syncId: "remote-sync-transient",
        rev: "remote-rev-transient",
        inventoryHash: invHash,
      },
    });
    // First poll: companion download fails (HTTP 500) → null-hash transient.
    await routeDropbox(page, { metaBytes, historyDownloadStatus: 500 });
    await suppressDiffModal(page);
    await page.evaluate(() => window.pollForRemoteChanges());

    const afterFail = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cloud_sync_last_pull") || "{}")
    );
    expect(afterFail.syncId).toBe("local-before-acceptance");
    expect(afterFail.itemPriceHistoryHash || null).toBeNull();
    const afterFailHist = await readPersistedHistory(page);
    expect((afterFailHist[ITEM_A] || []).map((e) => e.ts)).not.toContain(REMOTE_TS);

    // Healthy retry: serve the companion vault and re-poll → merge succeeds and
    // the stale syncId did not trip the same-syncId shortcut into skipping.
    await page.unrouteAll();
    const historyVaultBytes = await encryptVaultPayload(page, REMOTE_HISTORY, SYNC_KEY);
    await routeDropbox(page, { metaBytes, historyVaultBytes });
    await suppressDiffModal(page);
    await page.evaluate(() => window.pollForRemoteChanges());

    const merged = await readPersistedHistory(page);
    const ts = (merged[ITEM_A] || []).map((e) => e.ts);
    expect(ts).toContain(LOCAL_TS);
    expect(ts).toContain(REMOTE_TS);
  });

  test("Edge 3 (manifest-first): a post-apply companion write-throw does not advance lastPull, and retries (STRK-224)", async ({
    page,
  }) => {
    // AC-7 / AC-8 / AC-9(c-manifest-first). The manifest-first deferred apply
    // (_deferredVaultRestore → _applyAndFinalize → companion pull) records syncId
    // before the strict companion write; on a throw the FULL prior lastPull must
    // remain intact so the next poll retries.
    await expectWriteThrowRetries(page, {
      syncId: "remote-sync-manifest",
      manifest: {
        version: 1,
        changes: [
          { itemKey: "strk224-add", itemName: "STRK-224 Added", type: "item-add", fields: [] },
        ],
        summary: { itemsAdded: 1, itemsEdited: 0, itemsDeleted: 0, settingsChanged: 0 },
      },
    });
  });

  test("Edge 3 (vault-first): a post-apply companion write-throw restores the prior lastPull, and retries (STRK-224)", async ({
    page,
  }) => {
    // AC-7 / AC-8 / AC-9(c-vault-first). The vault-first apply records syncId inside
    // showRestorePreviewModal.onApply (_applyAndFinalize) BEFORE the post-apply
    // companion write; on a throw the pre-apply lastPull must be restored. The
    // snapshot MUST be captured before the apply — a post-apply snapshot is a defect.
    await expectWriteThrowRetries(page, { syncId: "remote-sync-vaultfirst" });
  });

  test("Edge 1/2 (local-newer): a transient companion failure does not push or advance lastPull (STRK-224)", async ({
    page,
  }) => {
    // A1 (Codacy HIGH). On a local-newer poll cycle the companion is merged before
    // scheduleSyncPush(). If that merge fails transiently, pushing would overwrite the
    // remote companion with un-merged local data and advance the remote syncId, so the
    // retry would never fire. The branch must bail (no push; lastPull held stale).
    await bootSynced(page);
    const remoteHash = await canonicalHash(page, REMOTE_HISTORY);
    // local-modified NEWER than the remote timestamp → local-newer branch. No
    // inventoryHash so the poll skips the silent fast-path and reaches that branch.
    await page.evaluate(
      (ts) => localStorage.setItem("cloud_sync_local_modified", new Date(ts).toISOString()),
      BASE_TS + 100000
    );
    const metaBytes = await buildRemoteMeta(page, {
      companionHash: remoteHash,
      overrides: { syncId: "remote-sync-localnewer", rev: "r", timestamp: BASE_TS + 5000 },
    });
    await routeDropbox(page, { metaBytes, historyDownloadStatus: 500 });
    await suppressDiffModal(page);

    const pushes = await page.evaluate(async () => {
      let calls = 0;
      window.scheduleSyncPush = () => {
        calls += 1;
      };
      await window.pollForRemoteChanges();
      return calls;
    });

    expect(pushes).toBe(0); // bailed on companion failure — did NOT push
    const lastPull = await readLastPull(page);
    expect(lastPull.syncId).toBe("local-before-acceptance"); // held stale for retry
  });

  test("Edge 3 (first-ever pull): a write-throw with null lastPull resets the watermark, not sticks it (STRK-224)", async ({
    page,
  }) => {
    // A3 (Copilot). When lastPull is null (first sync) the snapshot is null; restoring
    // null is a valid reset that re-enables the retry. The restore must NOT be skipped,
    // or the watermark sticks at the advanced syncId forever.
    await bootSynced(page);
    await page.evaluate(() => localStorage.removeItem("cloud_sync_last_pull"));
    const remoteHash = await canonicalHash(page, REMOTE_HISTORY);
    const vaultBytes = await encryptVaultPayload(
      page,
      { data: { metalInventory: JSON.stringify([REMOTE_ITEM_DIFF]) } },
      SYNC_KEY
    );
    const historyVaultBytes = await encryptVaultPayload(page, REMOTE_HISTORY, SYNC_KEY);
    await routeDropbox(page, { vaultBytes, historyVaultBytes });
    const remoteMeta = {
      syncId: "remote-sync-firstpull",
      timestamp: BASE_TS + 5000,
      rev: "remote-rev-firstpull",
      deviceId: "remote-device",
      itemCount: LOCAL_INVENTORY.length,
      itemPriceHistoryVault: { hash: remoteHash, uuidCount: 1, entryCount: 1 },
    };

    expect(await pullApplying(page, remoteMeta, { throwWrite: true })).toBeGreaterThan(0);
    // The watermark must NOT be stuck at the advanced syncId (restored to null).
    const stuckSyncId = await page.evaluate(() => {
      const lp = JSON.parse(localStorage.getItem("cloud_sync_last_pull") || "null");
      return lp ? lp.syncId : null;
    });
    expect(stuckSyncId).not.toBe("remote-sync-firstpull");
    // Retry with the healthy write restored → companion merges.
    await pullApplying(page, remoteMeta, { throwWrite: false });
    expect(await historyTsForItemA(page)).toContain(REMOTE_TS);
  });
});

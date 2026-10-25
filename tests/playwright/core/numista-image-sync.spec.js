import { test, expect } from "../helpers/mocks/extended-test.js";

// STRK-166 — bulk "Sync Image URLs from Numista" backfill.
// Contract: window.syncNumistaImageUrls() populates obverse/reverse CDN URLs on
// items that have a Numista catalog ID but are missing one or both image URLs.
// It fetches each catalog ID once (donor copy for duplicates), skips items that
// already have both images, and never overwrites an existing URL.

const mkItem = (over) => ({
  uuid: over.uuid,
  metal: "Silver",
  composition: "Silver",
  name: over.uuid,
  qty: 1,
  type: "Coin",
  weight: 31.1,
  weightUnit: "oz",
  price: 40,
  marketValue: 0,
  date: "2026-06-06",
  purchaseLocation: "StakTrakr",
  storageLocation: "",
  notes: "",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  purity: 0.999,
  spotPriceAtPurchase: 32,
  premiumPerOz: 0,
  totalPremium: 0,
  numistaId: over.numistaId,
  obverseImageUrl: over.obverseImageUrl || "",
  reverseImageUrl: over.reverseImageUrl || "",
  serial: over.serial,
});

// A & B share catalog 111 (donor dedup). C has obverse, missing reverse.
// D already has both (skipped). E has no Numista ID (ignored).
const INVENTORY = [
  mkItem({ uuid: "A", numistaId: "111", serial: 1 }),
  mkItem({ uuid: "B", numistaId: "111", serial: 2 }),
  mkItem({ uuid: "C", numistaId: "222", obverseImageUrl: "https://existing/c-o.jpg", serial: 3 }),
  mkItem({
    uuid: "D",
    numistaId: "333",
    obverseImageUrl: "https://existing/d-o.jpg",
    reverseImageUrl: "https://existing/d-r.jpg",
    serial: 4,
  }),
  mkItem({ uuid: "E", numistaId: "", serial: 5 }),
];

async function seed(page) {
  await page.addInitScript((inv) => {
    localStorage.setItem("metalInventory", JSON.stringify(inv));
    localStorage.setItem(
      "catalog_api_config",
      JSON.stringify({ numista: { apiKey: btoa("fake-test-key"), quota: 2000 } })
    );
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  }, INVENTORY);
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.syncNumistaImageUrls === "function" &&
      window.catalogAPI &&
      Array.isArray(window.inventory)
  );
}

async function installStubs(page) {
  await page.evaluate(() => {
    // Auto-confirm + silence alerts (custom modal helpers).
    window.showAppConfirm = async () => true;
    window.appConfirm = async () => true;
    window.showAppAlert = async () => {};
    window.appAlert = async () => {};
    // Truthy cache -> handler treats lookups as cache hits (skips the throttle).
    window.loadNumistaCache = () => ({ cached: true });
    // Count lookups per catalog ID and return deterministic image URLs.
    window.__lookups = [];
    window.catalogAPI.lookupItem = async (catId) => {
      window.__lookups.push(String(catId));
      return {
        imageUrl: `https://img.test/${catId}-o.jpg`,
        reverseImageUrl: `https://img.test/${catId}-r.jpg`,
      };
    };
  });
}

test.describe("bulk Sync Image URLs", () => {
  test("backfills missing image URLs, dedups by catalog ID, preserves existing", async ({
    page,
  }) => {
    await seed(page);
    await gotoApp(page);
    await installStubs(page);

    await page.evaluate(() => window.syncNumistaImageUrls());

    const { byUuid, lookups } = await page.evaluate(() => {
      const byUuid = {};
      for (const i of window.inventory) {
        byUuid[i.uuid] = { o: i.obverseImageUrl, r: i.reverseImageUrl };
      }
      return { byUuid, lookups: window.__lookups };
    });

    // A: both images backfilled from catalog 111
    expect(byUuid.A).toEqual({ o: "https://img.test/111-o.jpg", r: "https://img.test/111-r.jpg" });
    // B: same catalog ID -> donor copy, no second lookup
    expect(byUuid.B).toEqual({ o: "https://img.test/111-o.jpg", r: "https://img.test/111-r.jpg" });
    // C: existing obverse preserved, missing reverse filled from catalog 222
    expect(byUuid.C).toEqual({ o: "https://existing/c-o.jpg", r: "https://img.test/222-r.jpg" });
    // D: already complete -> untouched, no lookup
    expect(byUuid.D).toEqual({ o: "https://existing/d-o.jpg", r: "https://existing/d-r.jpg" });
    // E: no Numista ID -> ignored
    expect(byUuid.E).toEqual({ o: "", r: "" });

    // Exactly one lookup per distinct eligible catalog ID (111, 222); never 333.
    expect(lookups.sort()).toEqual(["111", "222"]);
  });
});

// STRK-458: the bulk sync modal's Start / Cancel buttons, progress bar and activity log
// are static markup that startBulkSync and logSyncActivity drive.
test.describe("bulk sync modal controls", () => {
  const overview = "#numistaSyncOverview";
  const startBtn = "#numistaSyncStartBtn";
  const cancelBtn = "#numistaSyncCancelBtn";
  const progress = "#numistaSyncProgress";
  const logLines = "#numistaSyncLog .cache-log-line";

  test.beforeEach(async ({ page }) => {
    await seed(page);
    await gotoApp(page);
    await installStubs(page);
    await page.waitForFunction(() => window.appListenersReady === true);
  });

  test("Start shows progress and log lines, Cancel aborts and resets the controls", async ({
    page,
  }) => {
    // cacheAll reports one step, then waits for abort() before it completes.
    await page.evaluate(() => {
      window.__aborts = 0;
      BulkImageCache.isRunning = () => false;
      BulkImageCache.cacheAll = ({ onProgress, onLog, onComplete }) =>
        new Promise((resolve) => {
          onProgress({ current: 1, total: 3, catalogId: "111" });
          onLog({ catalogId: "111", status: "metadata", message: "Metadata synced" });
          BulkImageCache.abort = () => {
            window.__aborts++;
            Promise.resolve(
              onComplete({ synced: 1, skipped: 0, failed: 0, apiLookups: 0, elapsed: 1200 })
            ).then(resolve);
          };
        });
      window.openBulkSyncModal("numista");
    });

    await expect(page.locator("#bulkSyncModal")).toBeVisible();
    await expect(page.locator(startBtn)).toBeVisible();
    await expect(page.locator(startBtn)).toBeEnabled();
    await expect(page.locator(cancelBtn)).toBeHidden();
    await expect(page.locator(progress)).toBeHidden();

    await page.locator(startBtn).click();

    await expect(page.locator(startBtn)).toBeDisabled();
    await expect(page.locator(cancelBtn)).toBeVisible();
    await expect(page.locator(progress)).toBeVisible();
    await expect(page.locator(progress)).toHaveJSProperty("value", 1);
    await expect(page.locator(progress)).toHaveJSProperty("max", 3);
    await expect(page.locator(logLines)).toHaveText([
      /Starting metadata sync/,
      /111: Metadata synced/,
    ]);
    await expect(page.locator(logLines).nth(1)).toBeVisible();

    await page.locator(cancelBtn).click();

    await expect(page.locator(startBtn)).toBeEnabled();
    await expect(page.locator(cancelBtn)).toBeHidden();
    await expect(page.locator(progress)).toBeHidden();
    await expect(page.locator(logLines).last()).toHaveText(/Complete in 1\.2s: 1 synced/);
    expect(await page.evaluate(() => window.__aborts)).toBe(1);
  });

  test("PCGS view hides the Numista controls without removing them", async ({ page }) => {
    await page.evaluate(() => window.openBulkSyncModal("pcgs"));
    await expect(page.locator("#bulkSyncPcgsPlaceholder")).toBeVisible();
    await expect(page.locator(overview)).toBeHidden();

    await page.evaluate(() => window.openBulkSyncModal("numista"));
    await page.evaluate(() => window.openBulkSyncModal("numista"));
    await expect(page.locator("#bulkSyncPcgsPlaceholder")).toBeHidden();
    await expect(page.locator(overview)).toBeVisible();
    await expect(page.locator(startBtn)).toBeVisible();
    await expect(page.locator("#numistaSyncActions .js-bulk-sync-images")).toHaveCount(1);
    await expect(page.locator("#numistaSyncLogDetails summary")).toHaveText("Activity log");
  });
});

// STRK-141 Phase 2 — Migrate market histories to IndexedDB.
//
// REGRESSION SPEC. Originally authored as the TDD red-phase suite (Phase 0,
// task 0.3) before the feature existed; now that the STRK-141 implementation has
// landed these tests pass and guard against regressions. Coverage:
//   - window.historyStore (the HistoryStore singleton) lifecycle
//   - the boot localStorage->IndexedDB migration (idempotent, decompress-aware)
//   - the item-price-history retention cap (applyItemPriceRetention)
//   - the backup export/restore exclusion of spot/retail history
//
// Each test maps to one or more acceptance criteria from
//   DocVault/specflow/StakTrakr/specs/STRK-141-migrate-market-histories-to-indexeddb/
//   {requirements.md, design.md (Testing Strategy)}.
//
// Conventions (StakTrakr Playwright gotchas):
//   - IndexedDB is asserted by driving window.historyStore via page.evaluate.
//   - The IDB-unavailable path is forced by stubbing window.indexedDB in an
//     addInitScript that runs BEFORE the app scripts load.
//   - Dates use toLocaleDateString('en-CA'), never toISOString().slice(0,10).

import { test, expect } from "../helpers/mocks/extended-test.js";

// --- Logical history keys (match constants.js literals) ---------------------
const SPOT_KEY = "metalSpotHistory";
const RETAIL_KEY = "v2RetailHistory";
const LEGACY_RETAIL_KEY = "retailPriceHistory";
const ITEM_PRICE_KEY = "item-price-history";
const MIGRATION_FLAG = "migration_idb_history_v1";
const HISTORY_DB = "StakTrakrHistory";
const HISTORY_STORE = "histories";

// Use recent timestamps so getPersistedSpotHistorySnapshot's 180-day seed trim
// never drops the seeded points out from under the assertions.
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

// Real spot-history entries carry STRING timestamps in the exact format
// `js/spot.js` writes: `new Date(t).toISOString().replace("T", " ").slice(0, 19)`
// → "YYYY-MM-DD HH:MM:SS" (space-separated, no trailing Z). Numeric timestamps
// fail getPersistedSpotHistorySnapshot's `typeof entry.timestamp === "string"`
// guard (js/spot.js:46) and get silently dropped, so loadSpotHistory hydrates
// empty. Mint matching string timestamps here.
const spotStamp = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

// Declaration order matches ascending timestamp order so the snapshot's
// localeCompare sort (js/spot.js:71) leaves the array unchanged and the
// `toEqual(SPOT_HISTORY)` assertions hold. Distinct second-resolution stamps
// avoid the `${timestamp}|${metal}` dedup collapsing entries.
const SPOT_HISTORY = [
  {
    timestamp: spotStamp(NOW - 2 * DAY),
    metal: "silver",
    spot: 31.11,
    source: "api",
    provider: "MetalsDev",
  },
  {
    timestamp: spotStamp(NOW - 1 * DAY - 60 * 1000),
    metal: "silver",
    spot: 31.42,
    source: "api",
    provider: "MetalsDev",
  },
  {
    timestamp: spotStamp(NOW - 1 * DAY),
    metal: "gold",
    spot: 2410.5,
    source: "api",
    provider: "MetalsDev",
  },
];

// A larger spot-history payload whose JSON exceeds the 4096-char compression
// threshold, so __compressIfNeeded actually emits a CMP2 blob (exercises R2.2,
// the decompress-on-migration path). String timestamps inside the 180-day
// runtime window, source:"api" (NOT "seed") so the seed-cutoff trim in
// getPersistedSpotHistorySnapshot keeps every entry.
const LARGE_SPOT_HISTORY = (() => {
  const metals = ["silver", "gold", "platinum", "palladium"];
  const out = [];
  for (let i = 0; i < 140; i++) {
    out.push({
      timestamp: spotStamp(NOW - (i + 1) * 60 * 60 * 1000),
      metal: metals[i % metals.length],
      spot: 30 + i * 0.137,
      source: "api",
      provider: "MetalsDev",
    });
  }
  return out;
})();

const RETAIL_HISTORY = {
  "silver-eagle": [
    { timestamp: spotStamp(NOW - 2 * DAY), price: 38.5, dealer: "apmex" },
    { timestamp: spotStamp(NOW - 1 * DAY), price: 39.1, dealer: "apmex" },
  ],
  "gold-eagle": [{ timestamp: spotStamp(NOW - 1 * DAY), price: 2620, dealer: "jmbullion" }],
};

// Suppress the What's New popup at boot (matches helpers/seed.js).
async function suppressWhatsNew(page) {
  await page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  });
}

// Seed legacy market histories into localStorage BEFORE the app boots.
async function seedLegacyHistory(page, { spot = SPOT_HISTORY, retail = RETAIL_HISTORY } = {}) {
  await page.addInitScript(
    ({ spotKey, retailKey, spotData, retailData }) => {
      if (spotData) localStorage.setItem(spotKey, JSON.stringify(spotData));
      if (retailData) localStorage.setItem(retailKey, JSON.stringify(retailData));
    },
    { spotKey: SPOT_KEY, retailKey: RETAIL_KEY, spotData: spot, retailData: retail }
  );
}

// Stub indexedDB unavailable BEFORE app scripts load (R3 graceful degradation).
async function stubIndexedDbUnavailable(page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        get() {
          return undefined;
        },
      });
    } catch {
      // Fallback for engines that reject the redefine: blank the open() entry.
      try {
        window.indexedDB = undefined;
      } catch {
        /* ignore */
      }
    }
  });
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
}

// Delete the StakTrakrHistory IndexedDB database and clear LS/SS for the current
// origin. Requires the page to already be on an origin that can reach
// indexedDB/localStorage (call AFTER a gotoApp, or in afterEach). Used both for
// cross-test isolation (no IDB bleed into other core specs — workers:1 shares
// the browser) and mid-test, between the migration test's compressor-priming
// boot and its real migration boot, so the boot migration is not pre-flagged.
async function clearHistoryState(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {
          /* ignore */
        }
        if (!window.indexedDB || typeof window.indexedDB.deleteDatabase !== "function") {
          resolve();
          return;
        }
        // The app's HistoryStore singleton holds an OPEN connection to
        // StakTrakrHistory for the lifetime of the page. With that connection
        // live, deleteDatabase() fires `onblocked` — NOT `onsuccess` — so the
        // database is NEVER actually deleted, only the resolve() fires. Because
        // Playwright reuses the same browser context (and IndexedDB) across tests
        // in a worker (workers:1), the populated spot-history DB would otherwise
        // survive into later core specs. Close the app's connection first so the
        // delete completes cleanly and this spec leaves a truly empty IndexedDB.
        try {
          if (window.historyStore && window.historyStore._db) {
            window.historyStore._db.close();
            window.historyStore._db = null;
            window.historyStore._available = false;
          }
        } catch {
          /* ignore */
        }
        const req = window.indexedDB.deleteDatabase("StakTrakrHistory");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      })
  );
}

// Wait for the new store singleton to come up. (RED: never appears today.)
async function waitForHistoryStore(page) {
  await page.waitForFunction(() => typeof window.historyStore !== "undefined", null, {
    timeout: 8000,
  });
}

// Read a record's `data` field straight from the raw IndexedDB store, so the
// assertion does not depend on historyStore's own getter behaving correctly.
async function readIdbRecord(page, key) {
  return page.evaluate(
    ({ dbName, storeName, recordKey }) =>
      new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          resolve({ __noIdb: true });
          return;
        }
        const open = window.indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction(storeName, "readonly");
          const req = tx.objectStore(storeName).get(recordKey);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const rec = req.result;
            db.close();
            resolve(rec ? rec.data : null);
          };
        };
      }),
    { dbName: HISTORY_DB, storeName: HISTORY_STORE, recordKey: key }
  );
}

test.describe("core/history-store-migration (STRK-141)", () => {
  // Isolation: this spec creates and populates the StakTrakrHistory IndexedDB on
  // boot. With workers:1 the browser process is shared, so a leaked DB bleeds
  // into later core specs (e.g. retail-market.spec.js). Start each test from a
  // clean origin (no DB, no LS/SS) and leave none behind.
  test.beforeEach(async ({ page }) => {
    // Land on the app origin once with no seeding so storage is reachable, let
    // the async fire-and-forget boot migration + seed bundle SETTLE (otherwise a
    // late write can land in IndexedDB after we wipe it — a race that re-seeds
    // the DB and re-sets the migration flag), then wipe everything. Individual
    // tests re-seed via addInitScript + their own gotoApp from this clean slate.
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page
      .waitForFunction(() => localStorage.getItem("migration_idb_history_v1") === "true", null, {
        timeout: 8000,
      })
      .catch(() => {});
    await clearHistoryState(page);
  });

  test.afterEach(async ({ page }) => {
    await clearHistoryState(page);
  });

  // -- Migration (R2.1, R2.2, R2.3) -----------------------------------------
  test("migrates compressed spot + plain retail history to IndexedDB and removes legacy LS keys", async ({
    page,
  }) => {
    await suppressWhatsNew(page);
    // First boot purely to obtain the app's real CMP2 compressor, so we can seed
    // a genuine Phase-1-compressed metalSpotHistory payload (R2.2).
    await gotoApp(page);
    await page.waitForFunction(() => typeof window.__compressIfNeeded === "function");
    const compressedSpot = await page.evaluate(
      (data) => window.__compressIfNeeded(JSON.stringify(data)),
      LARGE_SPOT_HISTORY
    );
    // Sanity guard: ensure we actually seeded a Phase-1 CMP2 blob (the whole
    // point of this test is the decompress-on-migration path).
    expect(compressedSpot.startsWith("CMP2:")).toBe(true);

    // The priming boot above already ran the boot migration (setting the
    // migration_idb_history_v1 flag) and seeded the LBMA bundle into the store.
    // Wipe that state so the upcoming boot performs a REAL migration of the
    // compressed LS payload instead of short-circuiting on the already-set flag.
    await clearHistoryState(page);

    // Re-seed LS with the compressed spot payload + plain retail, then re-boot.
    await page.addInitScript(
      ({ spotKey, retailKey, spotBlob, retailData }) => {
        localStorage.setItem(spotKey, spotBlob);
        localStorage.setItem(retailKey, JSON.stringify(retailData));
      },
      {
        spotKey: SPOT_KEY,
        retailKey: RETAIL_KEY,
        spotBlob: compressedSpot,
        retailData: RETAIL_HISTORY,
      }
    );
    await suppressWhatsNew(page);
    await gotoApp(page);
    await waitForHistoryStore(page);
    // Let the awaited boot migration settle.
    await page.waitForFunction(() => localStorage.getItem("migration_idb_history_v1") === "true", {
      timeout: 8000,
    });

    const idbSpot = await readIdbRecord(page, SPOT_KEY);
    const idbRetail = await readIdbRecord(page, RETAIL_KEY);
    const lsState = await page.evaluate(
      ({ spotKey, retailKey, flag }) => ({
        spotLs: localStorage.getItem(spotKey),
        retailLs: localStorage.getItem(retailKey),
        flag: localStorage.getItem(flag),
      }),
      { spotKey: SPOT_KEY, retailKey: RETAIL_KEY, flag: MIGRATION_FLAG }
    );

    // Decompressed, every data point preserved (R2.1, R2.2). Boot may also
    // fire-and-forget the LBMA spot seed bundle into the store, so the spot
    // record can be a SUPERSET of the migrated payload rather than exactly equal.
    // Assert containment: every migrated data point is present in the store (the
    // AC is "preserving every data point", not "the store equals only the seed").
    expect(Array.isArray(idbSpot)).toBe(true);
    for (const entry of LARGE_SPOT_HISTORY) {
      expect(idbSpot).toContainEqual(entry);
    }
    // Retail history is not seeded at boot, so it round-trips exactly.
    expect(idbRetail).toEqual(RETAIL_HISTORY);
    // Legacy LS copies reclaimed (R2.3).
    expect(lsState.spotLs).toBeNull();
    expect(lsState.retailLs).toBeNull();
    // Idempotency flag set (R2.4).
    expect(lsState.flag).toBe("true");
  });

  // -- Idempotency (R2.4, R2.5) ---------------------------------------------
  test("second boot performs no migration and leaves migrated data unchanged", async ({ page }) => {
    await suppressWhatsNew(page);
    await seedLegacyHistory(page);
    await gotoApp(page);
    await waitForHistoryStore(page);
    await page.waitForFunction(() => localStorage.getItem("migration_idb_history_v1") === "true", {
      timeout: 8000,
    });

    // Boot fetches live spot prices (mocked) and appends them, so the migrated
    // record is a SUPERSET of the seeded payload. Assert containment of every
    // migrated data point (R2.1) rather than exact equality.
    const firstSpot = await readIdbRecord(page, SPOT_KEY);
    expect(Array.isArray(firstSpot)).toBe(true);
    for (const entry of SPOT_HISTORY) {
      expect(firstSpot).toContainEqual(entry);
    }

    // Mutate the IDB record directly with a sentinel marker, then re-boot. A
    // re-run migration would overwrite it from a (now-absent) LS copy; an
    // idempotent boot must not. The marker carries a VALID recent STRING
    // timestamp so getPersistedSpotHistorySnapshot keeps it (a numeric timestamp
    // would be filtered out, emptying spotHistory and triggering the first-time
    // seed merge, which would overwrite the record — masking the idempotency
    // check). source "marker" + a unique metal make it unambiguous.
    const marker = {
      timestamp: spotStamp(NOW - 3 * 60 * 60 * 1000),
      metal: "marker",
      spot: 1,
      source: "marker",
    };
    await page.evaluate(
      ({ dbName, storeName, recordKey, markerEntry }) =>
        new Promise((resolve, reject) => {
          const open = window.indexedDB.open(dbName);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).put({
              key: recordKey,
              data: [markerEntry],
              updatedAt: Date.now(),
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        }),
      { dbName: HISTORY_DB, storeName: HISTORY_STORE, recordKey: SPOT_KEY, markerEntry: marker }
    );

    await suppressWhatsNew(page);
    await gotoApp(page);
    await waitForHistoryStore(page);
    await page.waitForTimeout(500);

    const secondSpot = await readIdbRecord(page, SPOT_KEY);
    // Marker survived => migration did NOT re-run (R2.5). Boot's live-spot fetch
    // may append entries, so assert the marker is still PRESENT (containment)
    // rather than that it is the sole record; the seeded SPOT_HISTORY must NOT
    // have been re-migrated back in (the LS copies were reclaimed on first boot).
    expect(Array.isArray(secondSpot)).toBe(true);
    expect(secondSpot).toContainEqual(marker);
    for (const entry of SPOT_HISTORY) {
      expect(secondSpot).not.toContainEqual(entry);
    }
  });

  // -- Graceful degradation (R3.1, R3.2, R3.3) ------------------------------
  test("with indexedDB unavailable, spot/retail load+save via localStorage, legacy keys kept, boot completes", async ({
    page,
  }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await stubIndexedDbUnavailable(page);
    await suppressWhatsNew(page);
    await seedLegacyHistory(page);
    await gotoApp(page);
    await waitForHistoryStore(page);

    const result = await page.evaluate(
      ({ spotKey, retailKey, flag, seeded }) => {
        const mem = Array.isArray(window.spotHistory) ? window.spotHistory : null;
        return {
          idbAbsent: !window.indexedDB,
          available: window.historyStore.isAvailable(),
          // Boot must have hydrated the in-memory globals from the LS fallback.
          // Boot also fetches live spot prices (mocked) and appends them, so the
          // global is a SUPERSET of the seeded LS entries — assert containment of
          // every seeded entry, not an exact count.
          spotMemArray: Array.isArray(mem),
          spotMemHasAllSeeded:
            mem &&
            seeded.every((s) =>
              mem.some(
                (e) => e.timestamp === s.timestamp && e.metal === s.metal && e.spot === s.spot
              )
            ),
          // Legacy LS copies must remain (R3.2 — never destroy the source of truth).
          spotLs: localStorage.getItem(spotKey),
          retailLs: localStorage.getItem(retailKey),
          // Migration flag must NOT be set when migration could not run (R3.1).
          flag: localStorage.getItem(flag),
        };
      },
      { spotKey: SPOT_KEY, retailKey: RETAIL_KEY, flag: MIGRATION_FLAG, seeded: SPOT_HISTORY }
    );

    expect(result.idbAbsent).toBe(true);
    expect(result.available).toBe(false);
    expect(result.spotMemArray).toBe(true);
    expect(result.spotMemHasAllSeeded).toBe(true);
    expect(result.spotLs).not.toBeNull();
    expect(result.retailLs).not.toBeNull();
    expect(result.flag).toBeNull();

    // A save in IDB-unavailable mode must still persist to localStorage (R3.1).
    // The entry needs a STRING timestamp or getPersistedSpotHistorySnapshot drops
    // it (typeof check) and an empty array would be persisted instead.
    const saved = await page.evaluate(
      ({ spotKey, stamp }) => {
        window.spotHistory = [{ timestamp: stamp, metal: "platinum", spot: 980, source: "api" }];
        window.saveSpotHistory();
        return localStorage.getItem(spotKey);
      },
      { spotKey: SPOT_KEY, stamp: spotStamp(NOW) }
    );
    expect(saved).not.toBeNull();
    expect(saved).toContain("platinum");

    // No unhandled error and boot completed (R3.3).
    expect(pageErrors).toEqual([]);
  });

  // -- Deferred-key fallback (R3.1, STRK-149 finding #1) ---------------------
  // The test above covers IDB *fully* unavailable. This covers the gap migrate()
  // can leave behind: IndexedDB IS available, but get() returns null for a key
  // that migrate() *deferred* (corrupt / wrong-shape / write-not-confirmed
  // payload kept in localStorage, NOT written to IDB). R3.1: "...OR a migration
  // write cannot be confirmed THEN continue reading from localStorage." The load
  // path must fall back to the LS copy instead of hydrating empty.
  test("deferred key (IDB available, get() null) hydrates spot+retail from the localStorage fallback", async ({
    page,
  }) => {
    await suppressWhatsNew(page);
    await gotoApp(page);
    await waitForHistoryStore(page);
    // Gate on the first-time boot's LBMA seed merge having COMPLETED before the
    // in-evaluate drain. Without this, under full-suite load the drain can observe
    // a premature "stable empty" store (boot has not written yet), break early,
    // and a late seed write then lands AFTER our remove() — repopulating the key.
    // (Same completion gate the R4 test below uses.)
    await page
      .waitForFunction(() => localStorage.getItem("migration_seedHistoryMerge") === "1", null, {
        timeout: 8000,
      })
      .catch(() => {});
    // Then drain + engineer the deferred state in ONE evaluate (no Playwright
    // gap). Boot also fire-and-forgets saveSpotHistory() IDB writes from its live
    // spot fetch; under workers:1 (shared browser/IDB) one can land AFTER our
    // remove() and defeat the null-state the test needs. Poll until the spot
    // record is STABLE across two reads (same technique as the R4 test) BEFORE
    // removing it, so get() deterministically returns null for the deferred key.
    const result = await page.evaluate(
      async ({ spotKey, retailKey, spotData, retailData }) => {
        const store = window.historyStore;
        await store.init();

        // Drain: wait until boot's fire-and-forget writes have flushed (the spot
        // record stops changing between reads).
        let prev = JSON.stringify(await store.get(spotKey));
        for (let i = 0; i < 50; i++) {
          await new Promise((r) => setTimeout(r, 40));
          const cur = JSON.stringify(await store.get(spotKey));
          if (cur === prev) break;
          prev = cur;
        }

        // Engineer the deferred state: IDB available, NO record for either key,
        // but a localStorage copy present — exactly what migrate() leaves when it
        // defers an unconfirmed payload.
        await store.remove(spotKey);
        await store.remove(retailKey);
        localStorage.setItem(spotKey, JSON.stringify(spotData));
        localStorage.setItem(retailKey, JSON.stringify(retailData));

        // Self-validation: confirm the precondition the fix hinges on — get()
        // returns null while the LS copy exists. If a leak made get() non-null,
        // this fails clearly instead of producing a confusing hydration mismatch.
        const getSpotNull = (await store.get(spotKey)) === null;
        const getRetailNull = (await store.get(retailKey)) === null;

        await window.loadSpotHistory();
        await window.loadRetailPriceHistory();

        return {
          available: store.isAvailable(),
          getSpotNull,
          getRetailNull,
          spotMem: window.spotHistory,
          retailMem: window.retailPriceHistory,
        };
      },
      {
        spotKey: SPOT_KEY,
        retailKey: RETAIL_KEY,
        spotData: SPOT_HISTORY,
        retailData: RETAIL_HISTORY,
      }
    );

    // Genuinely the IDB-AVAILABLE path with a null get() (deferred key), NOT the
    // IDB-unavailable path the test above already covers.
    expect(result.available).toBe(true);
    expect(result.getSpotNull).toBe(true);
    expect(result.getRetailNull).toBe(true);
    // Spot: every seeded LS entry hydrated the in-memory global via the fallback
    // (without the fix, get()===null makes spotHistory hydrate as []).
    expect(Array.isArray(result.spotMem)).toBe(true);
    for (const entry of SPOT_HISTORY) {
      expect(result.spotMem).toContainEqual(entry);
    }
    // Retail: the LS copy hydrated the global (without the fix it would be {}).
    expect(result.retailMem).toEqual(RETAIL_HISTORY);
  });

  // -- Cleanup safety (R2/R3, design-review finding 1) ----------------------
  test("cleanupStorage keeps spot/retail history keys and migration flag when IDB is unavailable", async ({
    page,
  }) => {
    await stubIndexedDbUnavailable(page);
    await suppressWhatsNew(page);
    await seedLegacyHistory(page);
    // Also pre-seed the migration flag to prove it is allowlisted, not purged.
    await page.addInitScript((flag) => localStorage.setItem(flag, "true"), MIGRATION_FLAG);
    await gotoApp(page);
    await waitForHistoryStore(page);
    await page.waitForFunction(() => typeof window.cleanupStorage === "function", null, {
      timeout: 8000,
    });

    const state = await page.evaluate(
      ({ spotKey, retailKey, flag }) => {
        // Run the boot cleanup explicitly so the assertion is deterministic.
        window.cleanupStorage();
        return {
          spotLs: localStorage.getItem(spotKey),
          retailLs: localStorage.getItem(retailKey),
          flag: localStorage.getItem(flag),
          spotAllowed:
            window.ALLOWED_STORAGE_KEYS instanceof Set
              ? window.ALLOWED_STORAGE_KEYS.has(spotKey)
              : window.ALLOWED_STORAGE_KEYS.includes(spotKey),
          flagAllowed:
            window.ALLOWED_STORAGE_KEYS instanceof Set
              ? window.ALLOWED_STORAGE_KEYS.has(flag)
              : window.ALLOWED_STORAGE_KEYS.includes(flag),
        };
      },
      { spotKey: SPOT_KEY, retailKey: RETAIL_KEY, flag: MIGRATION_FLAG }
    );

    expect(state.spotLs).not.toBeNull();
    expect(state.retailLs).not.toBeNull();
    expect(state.flag).toBe("true");
    expect(state.spotAllowed).toBe(true);
    expect(state.flagAllowed).toBe(true);
  });

  // -- No blank charts (R4) -------------------------------------------------
  test("first render of the spot history table shows data hydrated from IndexedDB (no empty flash)", async ({
    page,
  }) => {
    await suppressWhatsNew(page);
    // Seed the data ONLY into IndexedDB (no localStorage copy). If the render
    // path still reads localStorage synchronously, the table will be empty —
    // proving the boot hydration into the in-memory global is required (R4).
    await gotoApp(page);
    await waitForHistoryStore(page);
    // Boot is a first-time user here, so it fire-and-forgets the LBMA seed bundle
    // into spotHistory + the store. Wait for that async seed merge to SETTLE
    // (it sets migration_seedHistoryMerge) before we overwrite the record.
    await page
      .waitForFunction(() => localStorage.getItem("migration_seedHistoryMerge") === "1", null, {
        timeout: 8000,
      })
      .catch(() => {});
    // PUT our payload, then re-hydrate + render — all in ONE evaluate so a
    // pending seed write cannot sneak into the gap between put and load.
    // saveSpotHistory's IDB write is fire-and-forget: gate first on the store
    // record being STABLE (two equal reads) so the one-shot seed write has
    // flushed, then put our 3-entry payload and confirm the read-back before
    // loading. This closes the race deterministically without weakening R4.
    const rendered = await page.evaluate(
      async ({ key, data }) => {
        await window.historyStore.init();
        localStorage.removeItem(key); // IndexedDB is the only source.

        // Wait until the boot seed's one-shot write has flushed (stable record).
        let prev = JSON.stringify(await window.historyStore.get(key));
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 40));
          const cur = JSON.stringify(await window.historyStore.get(key));
          if (cur === prev) break;
          prev = cur;
        }

        // Overwrite with exactly our payload; confirm the read-back matches.
        for (let attempt = 0; attempt < 25; attempt++) {
          await window.historyStore.put(key, data);
          const back = await window.historyStore.get(key);
          if (Array.isArray(back) && back.length === data.length) break;
          await new Promise((r) => setTimeout(r, 50));
        }

        // Re-hydrate from the store the way boot does, then render once.
        if (typeof window.loadSpotHistory === "function") await window.loadSpotHistory();
        window.renderSpotHistoryTable();
        const tbody = document.querySelector("#settingsSpotHistoryTable tbody");
        return {
          rowCount: tbody ? tbody.querySelectorAll("tr").length : -1,
          isEmptyState: tbody ? /No spot price history/i.test(tbody.textContent || "") : true,
          inMemory: Array.isArray(window.spotHistory) ? window.spotHistory.length : -1,
        };
      },
      { key: SPOT_KEY, data: SPOT_HISTORY }
    );

    expect(rendered.inMemory).toBe(SPOT_HISTORY.length);
    expect(rendered.isEmptyState).toBe(false);
    expect(rendered.rowCount).toBe(SPOT_HISTORY.length);
  });

  // -- Quota safety (R1.3) --------------------------------------------------
  test("a historyStore.put rejecting with QuotaExceededError falls back without throwing or corrupting memory", async ({
    page,
  }) => {
    await suppressWhatsNew(page);
    await gotoApp(page);
    await waitForHistoryStore(page);

    const result = await page.evaluate(async () => {
      await window.historyStore.init();
      // Force the underlying IDB write to reject with a quota error.
      const quotaErr =
        typeof DOMException === "function"
          ? new DOMException("quota", "QuotaExceededError")
          : Object.assign(new Error("quota"), { name: "QuotaExceededError" });

      const stored = [{ timestamp: Date.now(), metal: "gold", spot: 2400, source: "api" }];
      window.spotHistory = stored.slice();

      // historyStore.put MUST swallow the quota rejection and return false.
      // Force the real IDB write to reject with a quota error by stubbing
      // IDBObjectStore.prototype.put — this exercises put()'s catch path
      // through the genuine IndexedDB call, with no production test hook.
      let threw = false;
      let putResult;
      const origIdbPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () {
        throw quotaErr;
      };
      try {
        putResult = await window.historyStore.put("metalSpotHistory", stored);
      } catch {
        threw = true;
      } finally {
        IDBObjectStore.prototype.put = origIdbPut;
      }

      return {
        threw,
        putResult,
        // In-memory global must be intact after a failed write.
        inMemoryIntact: JSON.stringify(window.spotHistory) === JSON.stringify(stored),
      };
    });

    expect(result.threw).toBe(false);
    expect(result.putResult).toBe(false);
    expect(result.inMemoryIntact).toBe(true);
  });

  // -- Retention cap (R6) ---------------------------------------------------
  test("item-price retention cap drops oldest beyond age cutoff and per-item limit while keeping newest", async ({
    page,
  }) => {
    await suppressWhatsNew(page);
    await gotoApp(page);
    await page.waitForFunction(() => typeof window.applyItemPriceRetention === "function", null, {
      timeout: 8000,
    });

    const result = await page.evaluate(() => {
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      // Item A: one entry just inside 365d, one well past it (must be dropped).
      // Item B: 1200 entries (must be capped to the newest 1000).
      const recent = { ts: now - 10 * day, itemName: "A", retail: 30, spot: 28, melt: 25 };
      const ancient = { ts: now - 400 * day, itemName: "A", retail: 20, spot: 18, melt: 16 };
      const itemB = [];
      for (let i = 0; i < 1200; i++) {
        itemB.push({ ts: now - (1200 - i) * 1000, itemName: "B", retail: i, spot: i, melt: i });
      }

      const history = { A: [ancient, recent], B: itemB };
      const capped = window.applyItemPriceRetention(history);

      const noControl =
        !document.querySelector('[data-setting="itemPriceRetention"]') &&
        !document.getElementById("itemPriceRetentionSetting") &&
        !document.getElementById("itemPriceHistoryRetentionInput");

      return {
        aLen: capped.A ? capped.A.length : 0,
        aKeptRecent: capped.A ? capped.A.some((e) => e.ts === recent.ts) : false,
        aDroppedAncient: capped.A ? !capped.A.some((e) => e.ts === ancient.ts) : true,
        bLen: capped.B ? capped.B.length : 0,
        // The newest of item B (retail 1199) must survive; the oldest (0) must go.
        bKeptNewest: capped.B ? capped.B.some((e) => e.retail === 1199) : false,
        bDroppedOldest: capped.B ? !capped.B.some((e) => e.retail === 0) : true,
        noControl,
      };
    });

    expect(result.aLen).toBe(1);
    expect(result.aKeptRecent).toBe(true);
    expect(result.aDroppedAncient).toBe(true);
    expect(result.bLen).toBe(1000);
    expect(result.bKeptNewest).toBe(true);
    expect(result.bDroppedOldest).toBe(true);
    expect(result.noControl).toBe(true);
  });

  // -- Backup surfaces: export (R7.1, R7.2) ---------------------------------
  test("ZIP and vault export exclude spot + retail history and include item-price history", async ({
    page,
  }) => {
    await suppressWhatsNew(page);
    await seedLegacyHistory(page);
    await page.addInitScript(
      ({ itemKey, legacyRetailKey }) => {
        localStorage.setItem(
          itemKey,
          JSON.stringify({ "uuid-1": [{ ts: Date.now(), itemName: "Eagle", retail: 35 }] })
        );
        // Legacy retail key also present so old export code paths are exercised.
        localStorage.setItem(legacyRetailKey, JSON.stringify({ "silver-eagle": [{ price: 38 }] }));
      },
      { itemKey: ITEM_PRICE_KEY, legacyRetailKey: LEGACY_RETAIL_KEY }
    );
    await gotoApp(page);
    await waitForHistoryStore(page);
    await page.waitForFunction(
      () =>
        typeof window.createBackupZip === "function" &&
        typeof window.collectVaultData === "function"
    );

    // --- ZIP export ---
    const zipResult = await page.evaluate(async () => {
      const blob = await window.createBackupZip();
      const zip = await window.JSZip.loadAsync(await blob.arrayBuffer());
      const names = Object.keys(zip.files);
      return {
        hasSpotFile: names.includes("spot_price_history.json"),
        hasRetailFile: names.includes("retail_price_history.json"),
        hasItemFile: names.includes("item_price_history.json"),
      };
    });
    expect(zipResult.hasSpotFile).toBe(false);
    expect(zipResult.hasRetailFile).toBe(false);
    expect(zipResult.hasItemFile).toBe(true);

    // --- Vault export ---
    const vaultResult = await page.evaluate(
      ({ spotKey, retailKey, legacyRetailKey, itemKey }) => {
        const payload = window.collectVaultData("full");
        const data = (payload && payload.data) || {};
        return {
          hasSpot: Object.prototype.hasOwnProperty.call(data, spotKey),
          hasRetail: Object.prototype.hasOwnProperty.call(data, retailKey),
          hasLegacyRetail: Object.prototype.hasOwnProperty.call(data, legacyRetailKey),
          hasItem: Object.prototype.hasOwnProperty.call(data, itemKey),
        };
      },
      {
        spotKey: SPOT_KEY,
        retailKey: RETAIL_KEY,
        legacyRetailKey: LEGACY_RETAIL_KEY,
        itemKey: ITEM_PRICE_KEY,
      }
    );
    expect(vaultResult.hasSpot).toBe(false);
    expect(vaultResult.hasRetail).toBe(false);
    expect(vaultResult.hasLegacyRetail).toBe(false);
    expect(vaultResult.hasItem).toBe(true);
  });

  // -- Old-backup restore (R7.3, design-review finding 2) -------------------
  test("restoring a vault containing spot+retail history ignores them (no LS, no IDB) but restores item-price", async ({
    page,
  }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await suppressWhatsNew(page);
    await gotoApp(page);
    await waitForHistoryStore(page);
    await page.waitForFunction(() => typeof window.restoreVaultData === "function", null, {
      timeout: 8000,
    });
    // First-time-user boot fire-and-forgets the LBMA seed bundle into the store.
    // Wait for that async seed merge to SETTLE (sets migration_seedHistoryMerge)
    // so the spot/retail IDB snapshot captured below is stable and not racing a
    // late seed write — otherwise before/after would differ for a reason other
    // than restore.
    await page
      .waitForFunction(() => localStorage.getItem("migration_seedHistoryMerge") === "1", null, {
        timeout: 8000,
      })
      .catch(() => {});

    const result = await page.evaluate(
      async ({ spotKey, retailKey, legacyRetailKey, itemKey, dbName, storeName }) => {
        // Start LS clean (item-price target must not pre-exist).
        localStorage.removeItem(spotKey);
        localStorage.removeItem(retailKey);
        localStorage.removeItem(legacyRetailKey);
        localStorage.removeItem(itemKey);

        // Read a record's `data` straight from the raw IDB store.
        function idbData(recordKey) {
          if (!window.indexedDB) return Promise.resolve(null);
          return new Promise((resolve) => {
            const open = window.indexedDB.open(dbName);
            open.onerror = () => resolve(null);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains(storeName)) {
                db.close();
                resolve(null);
                return;
              }
              const tx = db.transaction(storeName, "readonly");
              const req = tx.objectStore(storeName).get(recordKey);
              req.onsuccess = () => {
                db.close();
                resolve(req.result ? req.result.data : null);
              };
              req.onerror = () => {
                db.close();
                resolve(null);
              };
            };
          });
        }

        // Boot legitimately fire-and-forgets the LBMA spot seed bundle into the
        // store, so the spot/retail IDB records are NOT empty before restore.
        // The seed's IDB write is itself fire-and-forget, so poll each record
        // until two successive reads match (stable) before snapshotting — this
        // guarantees the before/after comparison isolates the restore's effect,
        // not a late seed write landing mid-test.
        async function stableIdb(recordKey) {
          let prev = JSON.stringify(await idbData(recordKey));
          for (let i = 0; i < 25; i++) {
            await new Promise((r) => setTimeout(r, 40));
            const cur = JSON.stringify(await idbData(recordKey));
            if (cur === prev) return JSON.parse(cur);
            prev = cur;
          }
          return JSON.parse(prev);
        }
        const spotIdbBefore = await stableIdb(spotKey);
        const retailIdbBefore = await stableIdb(retailKey);

        const itemHistory = { "uuid-7": [{ ts: Date.now(), itemName: "Maple", retail: 41 }] };
        // An OLD backup payload that still carries spot + retail history. Its
        // spot/retail entries are distinctive (provider "OLDBACKUP") so we can
        // detect if restore ever wrote them into the store.
        const payload = {
          _meta: { appVersion: "old", scope: "full" },
          data: {
            [spotKey]: JSON.stringify([
              {
                timestamp: "2020-01-01 00:00:00",
                metal: "silver",
                spot: 30,
                source: "api",
                provider: "OLDBACKUP",
              },
            ]),
            [retailKey]: JSON.stringify({ "oldbackup-slug": [{ price: 38 }] }),
            [legacyRetailKey]: JSON.stringify({ "oldbackup-slug": [{ price: 38 }] }),
            [itemKey]: JSON.stringify(itemHistory),
          },
        };

        let threw = false;
        try {
          await window.restoreVaultData(payload);
        } catch {
          threw = true;
        }

        const spotIdbAfter = await idbData(spotKey);
        const retailIdbAfter = await idbData(retailKey);

        const containsOldBackupSpot = Array.isArray(spotIdbAfter)
          ? spotIdbAfter.some((e) => e && e.provider === "OLDBACKUP")
          : false;
        const containsOldBackupRetail =
          retailIdbAfter && typeof retailIdbAfter === "object"
            ? Object.prototype.hasOwnProperty.call(retailIdbAfter, "oldbackup-slug")
            : false;

        return {
          threw,
          spotLs: localStorage.getItem(spotKey),
          retailLs: localStorage.getItem(retailKey),
          legacyRetailLs: localStorage.getItem(legacyRetailKey),
          itemLs: localStorage.getItem(itemKey),
          // IDB spot/retail unchanged by restore (deep-equal before vs after).
          spotIdbUnchanged: JSON.stringify(spotIdbBefore) === JSON.stringify(spotIdbAfter),
          retailIdbUnchanged: JSON.stringify(retailIdbBefore) === JSON.stringify(retailIdbAfter),
          // And the old-backup spot/retail payloads were NOT written into IDB.
          containsOldBackupSpot,
          containsOldBackupRetail,
        };
      },
      {
        spotKey: SPOT_KEY,
        retailKey: RETAIL_KEY,
        legacyRetailKey: LEGACY_RETAIL_KEY,
        itemKey: ITEM_PRICE_KEY,
        dbName: HISTORY_DB,
        storeName: HISTORY_STORE,
      }
    );

    // No error raised (R7.3).
    expect(result.threw).toBe(false);
    expect(pageErrors).toEqual([]);
    // Spot/retail from the old backup written to NEITHER localStorage NOR IDB:
    // the LS keys stay null and the IDB records are byte-for-byte the same as the
    // boot-seeded state captured before restore (restore ignored them).
    expect(result.spotLs).toBeNull();
    expect(result.retailLs).toBeNull();
    expect(result.legacyRetailLs).toBeNull();
    expect(result.spotIdbUnchanged).toBe(true);
    expect(result.retailIdbUnchanged).toBe(true);
    expect(result.containsOldBackupSpot).toBe(false);
    expect(result.containsOldBackupRetail).toBe(false);
    // Item-price history IS restored.
    expect(result.itemLs).not.toBeNull();
    expect(result.itemLs).toContain("Maple");
  });

  // -- Sync scope unchanged (R5.1, R5.2) ------------------------------------
  test("no market-history key is in the cloud auto-sync scope", async ({ page }) => {
    await suppressWhatsNew(page);
    await gotoApp(page);
    await page.waitForFunction(() => typeof window.SYNC_SCOPE_KEYS !== "undefined", null, {
      timeout: 8000,
    });

    const scope = await page.evaluate(
      ({ spotKey, retailKey, legacyRetailKey, itemKey }) => {
        const keys = Array.isArray(window.SYNC_SCOPE_KEYS)
          ? window.SYNC_SCOPE_KEYS
          : Array.from(window.SYNC_SCOPE_KEYS || []);
        return {
          keys,
          hasSpot: keys.includes(spotKey),
          hasRetail: keys.includes(retailKey),
          hasLegacyRetail: keys.includes(legacyRetailKey),
          hasItem: keys.includes(itemKey),
          hasHistoryFlag: keys.includes("migration_idb_history_v1"),
        };
      },
      {
        spotKey: SPOT_KEY,
        retailKey: RETAIL_KEY,
        legacyRetailKey: LEGACY_RETAIL_KEY,
        itemKey: ITEM_PRICE_KEY,
      }
    );

    expect(scope.hasSpot).toBe(false);
    expect(scope.hasRetail).toBe(false);
    expect(scope.hasLegacyRetail).toBe(false);
    expect(scope.hasItem).toBe(false);
    expect(scope.hasHistoryFlag).toBe(false);
  });
});

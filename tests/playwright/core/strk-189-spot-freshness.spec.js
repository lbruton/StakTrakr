// STRK-189 — Spot sync freshness guard (generated_at)
//
// Verifies the consumer-side freshness gate on /spot/latest.json:
//   1. A stale api1 payload fails over to api2 (validator inside _staktrakrFetch).
//   2. When both endpoints are stale the sync fails: nothing displayed, written,
//      or recorded with a wall-clock timestamp.
//   3. Accepted payloads record spot history with the envelope's generated_at,
//      not the wall-clock fetch time.
//   4. Monotonic guard: an older payload never overwrites a fresher accepted one.
//
// Route precedence: per-test page.route registrations are LIFO — they win over
// the extended-test fixture's default mocks for the same URL.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";
import { makeSpotLatest } from "../helpers/mocks/fixtures.js";

const SPOT_LATEST_API1 = "https://api.staktrakr.com/data/v2/spot/latest.json";
const SPOT_LATEST_API2 = "https://api2.staktrakr.com/data/v2/spot/latest.json";

const hoursAgoIso = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();
const minutesAgoIso = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();

// recordSpot stores timestamps as "YYYY-MM-DD HH:MM:SS" (UTC, second precision)
const toHistoryTimestamp = (iso) => new Date(iso).toISOString().replace("T", " ").slice(0, 19);

async function routeSpotLatest(page, url, payload) {
  await page.route(url, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    })
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#spotPriceDisplaySilver", { state: "visible" });
  await page.waitForFunction(() => typeof window.syncSpotProvider === "function");
}

const forceSync = (page) => page.evaluate(() => window.syncSpotProvider({ forceSync: true }));

// window.spotHistory is the live in-memory array (getter exposed in spot.js);
// reading localStorage directly is unreliable — saveDataSync may compress the value
const readSpotHistory = (page) => page.evaluate(() => window.spotHistory || []);

test.describe("STRK-189 — spot payload freshness gate", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("stale api1 payload fails over to fresh api2 payload", async ({ page }) => {
    const staleIso = hoursAgoIso(3);
    const freshIso = minutesAgoIso(5);
    await routeSpotLatest(
      page,
      SPOT_LATEST_API1,
      makeSpotLatest({ xag: { price: 11.11 } }, staleIso)
    );
    await routeSpotLatest(
      page,
      SPOT_LATEST_API2,
      makeSpotLatest({ xag: { price: 33.33 } }, freshIso)
    );

    await gotoApp(page);
    const result = await forceSync(page);
    expect(result.results.STAKTRAKR).toBe("success");

    // Display and storage carry the api2 price — the stale api1 price never lands
    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("33.33");
    expect(await page.evaluate(() => localStorage.getItem("spotSilver"))).toBe("33.33");

    // History row carries api2's generated_at and price; no row carries the stale price
    const history = await readSpotHistory(page);
    const accepted = history.filter((row) => row.spot === 33.33 && row.metal === "Silver");
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.some((row) => row.timestamp === toHistoryTimestamp(freshIso))).toBe(true);
    expect(history.some((row) => row.spot === 11.11)).toBe(false);
  });

  test("STRK-331 strict-first: api1 in the 20m–2h window loses to a fresh api2", async ({
    page,
  }) => {
    // The gap v3.35.96 left open: 25m passes the LENIENT gate (max(20m × 6, 2h)),
    // so first-acceptable selection served api1's stale payload for up to 2h
    // while api2 sat fresh — the badge's cry-wolf window was really a
    // data-path bug. _fetchFreshestSpotEnvelope now fetches every endpoint and
    // takes the newest generated_at among lenient-gate passers, so api2 wins
    // here while the all-stale test below still pins "everything stale → fail".
    const windowIso = minutesAgoIso(25);
    const freshIso = minutesAgoIso(5);
    await routeSpotLatest(
      page,
      SPOT_LATEST_API1,
      makeSpotLatest({ xag: { price: 22.22 } }, windowIso)
    );
    await routeSpotLatest(
      page,
      SPOT_LATEST_API2,
      makeSpotLatest({ xag: { price: 44.44 } }, freshIso)
    );

    await gotoApp(page);
    const result = await forceSync(page);
    expect(result.results.STAKTRAKR).toBe("success");

    // api2's fresher price is what lands — api1's window-stale price never does
    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("44.44");
    expect(await page.evaluate(() => localStorage.getItem("spotSilver"))).toBe("44.44");
    const history = await readSpotHistory(page);
    expect(history.some((row) => row.spot === 44.44 && row.metal === "Silver")).toBe(true);
    expect(history.some((row) => row.spot === 22.22)).toBe(false);
  });

  test("all-stale endpoints: sync fails, nothing displayed, written, or recorded", async ({
    page,
  }) => {
    const staleIso = hoursAgoIso(3);
    await routeSpotLatest(
      page,
      SPOT_LATEST_API1,
      makeSpotLatest({ xag: { price: 11.11 } }, staleIso)
    );
    await routeSpotLatest(
      page,
      SPOT_LATEST_API2,
      makeSpotLatest({ xag: { price: 22.22 } }, staleIso)
    );

    await gotoApp(page);
    // Boot hydrates spotSilver from the bundled annual history — capture the
    // post-boot value and prove the failed sync leaves it untouched
    const before = await page.evaluate(() => localStorage.getItem("spotSilver"));

    const result = await forceSync(page);
    expect(result.results.STAKTRAKR).toBe("error");

    // Price unchanged; the stale payloads' prices never landed anywhere
    expect(await page.evaluate(() => localStorage.getItem("spotSilver"))).toBe(before);
    expect(["11.11", "22.22"]).not.toContain(before);
    await expect(page.locator("#spotPriceDisplaySilver")).not.toContainText("11.11");
    await expect(page.locator("#spotPriceDisplaySilver")).not.toContainText("22.22");

    // No spot history rows were recorded from the rejected payloads
    const history = await readSpotHistory(page);
    expect(history.filter((row) => row.source === "api")).toHaveLength(0);
  });

  test("accepted payload records history with the envelope generated_at, not wall clock", async ({
    page,
  }) => {
    const freshIso = minutesAgoIso(5);
    await routeSpotLatest(
      page,
      SPOT_LATEST_API1,
      makeSpotLatest({ xag: { price: 44.44 } }, freshIso)
    );

    await gotoApp(page);
    const result = await forceSync(page);
    expect(result.results.STAKTRAKR).toBe("success");

    const history = await readSpotHistory(page);
    const rows = history.filter(
      (row) => row.spot === 44.44 && row.metal === "Silver" && row.source === "api"
    );
    expect(rows.length).toBeGreaterThan(0);
    // The live-sync row carries the publication timestamp (5 minutes ago), not "now"
    expect(rows.some((row) => row.timestamp === toHistoryTimestamp(freshIso))).toBe(true);
  });

  test("monotonic guard: an older payload never overwrites a fresher accepted one", async ({
    page,
  }) => {
    const freshIso = minutesAgoIso(5);
    await routeSpotLatest(
      page,
      SPOT_LATEST_API1,
      makeSpotLatest({ xag: { price: 66.66 } }, freshIso)
    );

    await gotoApp(page);
    const first = await forceSync(page);
    expect(first.results.STAKTRAKR).toBe("success");
    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("66.66");

    // Re-route api1 to an OLDER payload that is still inside the freshness
    // threshold (30 min < 2 h) — isolates the monotonic guard from the gate
    const olderIso = minutesAgoIso(30);
    await routeSpotLatest(
      page,
      SPOT_LATEST_API1,
      makeSpotLatest({ xag: { price: 12.34 } }, olderIso)
    );

    const second = await forceSync(page);
    expect(second.results.STAKTRAKR).toBe("stale");

    // First price retained everywhere; older payload left no trace
    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("66.66");
    expect(await page.evaluate(() => localStorage.getItem("spotSilver"))).toBe("66.66");
    const history = await readSpotHistory(page);
    expect(history.some((row) => row.spot === 12.34)).toBe(false);
  });
});

// STRK-170 cohort 3.1 — characterization guard for fetchLatestPrices (the
// per-provider individual-endpoint dispatch reached for non-STAKTRAKR sources).
// Drives the function through window.syncSpotProvider with the METAL_PRICE_API
// provider configured: routes its per-metal /latest endpoints and asserts the
// normalized {metal: price} map that lands in localStorage. Behavior-preserving
// regression guard for the complexity refactor — must stay GREEN before & after.
const METAL_PRICE_API_LATEST = "https://api.metalpriceapi.com/v1/latest*";

/**
 * Route METAL_PRICE_API's per-metal /latest endpoint to a fixed rate map.
 * METAL_PRICE_API.parseResponse returns 1/rate (rate is metal-per-USD), so a
 * rate of r yields a displayed price of 1/r. A currency absent from the map
 * fulfills with an empty rates object (exercises the "no price" skip branch).
 * @param {import('@playwright/test').Page} page
 * @param {Object<string, number>} ratesByCurrency - e.g. { XAG: 0.04, XAU: 0.0005 }
 * @returns {Promise<void>}
 */
async function routeMetalPriceApi(page, ratesByCurrency) {
  await page.route(METAL_PRICE_API_LATEST, (route) => {
    const url = new URL(route.request().url());
    const currency = url.searchParams.get("currencies");
    const rate = ratesByCurrency[currency];
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, rates: rate ? { [currency]: rate } : {} }),
    });
  });
}

/**
 * Configure the in-page API store so syncSpotProvider routes to METAL_PRICE_API
 * with a key and silver/gold selected. Uses the script-tag globals
 * loadApiConfig/saveApiConfig (not on window) inside the page realm.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function configureMetalPriceApi(page) {
  await page.evaluate(() => {
    window.saveDataSync("spotPricingSource", "METAL_PRICE_API");
    // loadApiConfig/saveApiConfig are script-tag globals (not on window) — reach
    // them as bare identifiers within the page realm.
    /* eslint-disable no-undef */
    const config = loadApiConfig();
    config.keys = { ...(config.keys || {}), METAL_PRICE_API: "test-key" };
    config.metals = {
      ...(config.metals || {}),
      METAL_PRICE_API: { silver: true, gold: true, platinum: false, palladium: false },
    };
    saveApiConfig(config);
    /* eslint-enable no-undef */
  });
}

test.describe("STRK-170 — fetchLatestPrices per-provider dispatch (characterization)", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("METAL_PRICE_API individual endpoints normalize 1/rate into the spot map", async ({
    page,
  }) => {
    // 1/0.04 = 25 (silver), 1/0.0005 = 2000 (gold)
    await routeMetalPriceApi(page, { XAG: 0.04, XAU: 0.0005 });

    await gotoApp(page);
    // loadApiConfig/saveApiConfig are script-tag globals needed by the setup
    await page.waitForFunction(() => typeof loadApiConfig === "function");
    await configureMetalPriceApi(page);

    // Platinum is unselected → its boot-hydrated value must survive the sync
    const platBefore = await page.evaluate(() => localStorage.getItem("spotPlatinum"));
    const result = await forceSync(page);
    expect(result.results.METAL_PRICE_API).toBe("success");

    // Normalized prices land in display + storage for both selected metals
    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("25");
    await expect(page.locator("#spotPriceDisplayGold")).toContainText("2,000");
    expect(await page.evaluate(() => localStorage.getItem("spotSilver"))).toBe("25");
    expect(await page.evaluate(() => localStorage.getItem("spotGold"))).toBe("2000");
    // Unselected platinum was never fetched → its value is untouched by this sync
    expect(await page.evaluate(() => localStorage.getItem("spotPlatinum"))).toBe(platBefore);
  });

  test("a provider endpoint returning no rate is skipped, the rest still land", async ({
    page,
  }) => {
    // Silver resolves (1/0.05 = 20); gold returns an empty rates object → skipped
    await routeMetalPriceApi(page, { XAG: 0.05 });

    await gotoApp(page);
    await page.waitForFunction(() => typeof loadApiConfig === "function");
    await configureMetalPriceApi(page);

    const goldBefore = await page.evaluate(() => localStorage.getItem("spotGold"));
    const result = await forceSync(page);
    expect(result.results.METAL_PRICE_API).toBe("success");

    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("20");
    expect(await page.evaluate(() => localStorage.getItem("spotSilver"))).toBe("20");
    // Gold had no valid rate → untouched (no overwrite, no zero)
    expect(await page.evaluate(() => localStorage.getItem("spotGold"))).toBe(goldBefore);
  });
});

// STRK-291 — per-card refresh icon coloured by spot-data freshness.
//
// Lives in this file rather than a new one because it is the same `spot-sync`
// coverage domain, and the file already hosts a second unrelated describe
// (STRK-170) — the precedent for grouping by domain over filename. AGENTS.md
// also discourages adding new issue-prefixed spec files.
//
// SUBJECT OF THE MEASUREMENT (this is the threshold reconciliation STRK-291
// asked for): these thresholds describe how old THIS BROWSER's spot data is.
// `API_HEALTH_SPOT_STALE_MIN = 20` in js/api-health.js measures something
// different — whether the publisher is still writing hourly files. Two numbers,
// two subjects, deliberately not unified. A user who syncs manually would sit
// permanently orange under a 20-minute local rule.
//
// WHY THESE TESTS SEED AFTER BOOT *AND* WAIT FOR IT TO GO QUIET: init.js runs
// the indicator at Phase 12 (line ~751) but fires `fetchSpotPrice()` at Phase 13
// (line ~762). Under the default network mock that fetch SUCCEEDS about 40 ms
// after DOMContentLoaded and writes a wall-clock `lastApiSync` once per metal —
// four writes in a ~5 ms burst — then re-runs the indicator. Any seed written
// before that burst is silently overwritten and every state collapses to
// "fresh".
//
// Waiting on `#spotPriceDisplaySilver` is NOT enough; the element is visible
// long before the fetch resolves. `waitForTimeout` would be a guess. Instead
// `installBootSyncProbe` counts writes to the two freshness keys and
// `gotoAppSettled` waits for quiescence — at least one write, then a clear gap
// with no further writes. That is deterministic and self-describing.
//
// This race is why the "expired" cases failed while "fresh" passed on the first
// green run: overwriting a fresh seed with a fresh value is invisible. The stale
// case passed only by luck of timing. Do not remove the settle step because the
// tests appear to pass without it.
const SPOT_METALS = ["Silver", "Gold", "Platinum", "Palladium"];
const FRESHNESS_CLASSES = [
  "spot-sync-icon--fresh",
  "spot-sync-icon--stale",
  "spot-sync-icon--expired",
];

/**
 * Returns an ISO 8601 timestamp the given number of minutes in the past.
 * @param {number} minutes - Minutes to subtract from the current time
 * @returns {string} ISO 8601 timestamp, e.g. "2026-07-30T21:05:00.000Z"
 */
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();

/** Quiet period with no freshness-key writes that counts as "boot has settled". */
const BOOT_SETTLE_MS = 400;

/**
 * Instruments `Storage.setItem` to count writes to the two freshness keys.
 * Must run before `page.goto` — install it in `beforeEach`.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
const installBootSyncProbe = (page) =>
  page.addInitScript(() => {
    window.__freshnessWrites = 0;
    window.__freshnessWriteAt = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === "lastApiSync" || key === "lastCacheRefresh") {
        window.__freshnessWrites += 1;
        window.__freshnessWriteAt = Date.now();
      }
      return original.call(this, key, value);
    };
  });

/**
 * Boots the app and waits until the boot sync has stopped writing timestamps,
 * so a subsequent seed cannot be overwritten. See the block comment above.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
async function gotoAppSettled(page) {
  await gotoApp(page);
  await page.waitForFunction(
    (quietMs) => window.__freshnessWrites > 0 && Date.now() - window.__freshnessWriteAt > quietMs,
    BOOT_SETTLE_MS
  );
}

/**
 * Overwrites the two freshness timestamp keys after boot, then re-runs the
 * indicator. Passing `null` DELETES a key — required for the no-data case,
 * because boot populates `lastCacheRefresh` from the bundled history and an
 * absent seed would otherwise be indistinguishable from a stale one.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {{apiSync?: object|null, cacheRefresh?: object|null}} seed - Entry per key
 * @returns {Promise<void>}
 */
async function seedFreshnessAndRefresh(page, { apiSync = null, cacheRefresh = null } = {}) {
  await page.evaluate(
    ({ api, cache }) => {
      if (api) localStorage.setItem("lastApiSync", JSON.stringify(api));
      else localStorage.removeItem("lastApiSync");
      if (cache) localStorage.setItem("lastCacheRefresh", JSON.stringify(cache));
      else localStorage.removeItem("lastCacheRefresh");
      window.updateSpotSyncHealthDot();
    },
    { api: apiSync, cache: cacheRefresh }
  );
}

/**
 * Returns the freshness modifier on each metal's refresh icon, in METALS order.
 * Reads the live class list rather than a computed colour so the assertion names
 * the state contract; the colour tokens themselves are asserted separately.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<Array<string|undefined>>} One modifier class per metal
 */
const readIconFreshness = (page) =>
  page.evaluate(
    ({ metals, classes }) =>
      metals.map((m) => {
        const el = document.getElementById(`syncIcon${m}`);
        return el ? [...el.classList].find((c) => classes.includes(c)) : undefined;
      }),
    { metals: SPOT_METALS, classes: FRESHNESS_CLASSES }
  );

/**
 * Asserts all four cards agree on one freshness state.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} expected - Expected modifier, e.g. "spot-sync-icon--fresh"
 * @returns {Promise<void>}
 */
async function expectAllIconsAt(page, expected) {
  expect(await readIconFreshness(page)).toEqual(SPOT_METALS.map(() => expected));
}

test.describe("STRK-291 — spot-card refresh icon freshness colour", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await installBootSyncProbe(page);
  });

  test("an API sync inside the hour reads fresh on all four cards", async ({ page }) => {
    await gotoAppSettled(page);
    await seedFreshnessAndRefresh(page, {
      apiSync: { provider: "STAKTRAKR", timestamp: minutesAgo(5) },
    });
    await expectAllIconsAt(page, "spot-sync-icon--fresh");
  });

  test("a sync between one hour and one day old reads stale", async ({ page }) => {
    await gotoAppSettled(page);
    await seedFreshnessAndRefresh(page, {
      apiSync: { provider: "STAKTRAKR", timestamp: minutesAgo(90) },
    });
    await expectAllIconsAt(page, "spot-sync-icon--stale");
  });

  test("a sync older than one day reads expired", async ({ page }) => {
    await gotoAppSettled(page);
    await seedFreshnessAndRefresh(page, {
      apiSync: { provider: "STAKTRAKR", timestamp: minutesAgo(60 * 30) },
    });
    await expectAllIconsAt(page, "spot-sync-icon--expired");
  });

  test("no timestamps at all reads stale, not expired", async ({ page }) => {
    // Preserves the pre-existing contract: "no data" was orange, never red. Red
    // is reserved for data known to be old, so an empty install does not open
    // on an alarm state.
    await gotoAppSettled(page);
    await seedFreshnessAndRefresh(page, { apiSync: null, cacheRefresh: null });
    await expectAllIconsAt(page, "spot-sync-icon--stale");
  });

  test("a cached entry inside its provider cache duration reads fresh despite its age", async ({
    page,
  }) => {
    // The load-bearing case for the fallback chain STRK-291 says to preserve.
    // A 2-hour-old timestamp is "stale" by raw age, but METAL_PRICE_API's cache
    // duration defaults to 24h, so the entry is still valid and must read fresh.
    // Asserting --fresh (not --stale) is what discriminates the cache-duration
    // branch from the plain-age branch; a regression that dropped the fallback
    // would return --stale here and this is the only test that would catch it.
    //
    // The provider must NOT be STAKTRAKR: getCacheDurationMs("STAKTRAKR")
    // returns 0 by design (js/api.js — static hourly files, no rate limit), so
    // `age <= duration` is unsatisfiable and this branch is unreachable for the
    // default source. The " (cached)" suffix mirrors what updateLastTimestamps
    // actually writes, so this also pins the suffix-stripping.
    await gotoAppSettled(page);
    await seedFreshnessAndRefresh(page, {
      apiSync: null,
      cacheRefresh: { provider: "METAL_PRICE_API (cached)", timestamp: minutesAgo(120) },
    });
    await expectAllIconsAt(page, "spot-sync-icon--fresh");
  });

  test("the cache window still wins when a real sync also wrote lastApiSync", async ({ page }) => {
    // THE PRODUCTION SHAPE of the test above, and the one that actually matters.
    // `updateLastTimestamps` writes BOTH keys on every successful API sync
    // (js/spot.js — saveDataSync to LAST_API_SYNC_KEY *and* LAST_CACHE_REFRESH_KEY),
    // so a real user is never in the lastApiSync-absent state the previous test
    // seeds. The test above deletes lastApiSync, which is exactly what let the
    // original implementation pass while being wrong in the field.
    //
    // Scenario: a keyed provider with a 24 h cache window synced 90 minutes ago.
    // Raw age says stale, but the app will not refetch until the window closes,
    // so amber would be telling the user to refresh when refreshing is a no-op.
    // Before the PR #1410 review fix this returned stale, because the
    // lastApiSync branch returned before the cache window was ever consulted.
    await gotoAppSettled(page);
    const ninetyMinutesAgo = minutesAgo(90);
    await seedFreshnessAndRefresh(page, {
      apiSync: { provider: "METAL_PRICE_API", timestamp: ninetyMinutesAgo },
      cacheRefresh: { provider: "METAL_PRICE_API", timestamp: ninetyMinutesAgo },
    });
    await expectAllIconsAt(page, "spot-sync-icon--fresh");
  });

  test("a cache window that has closed falls back to plain age", async ({ page }) => {
    // The other side of the precedence change: putting the cache check first
    // must not make everything permanently fresh. STAKTRAKR's cache duration is
    // 0, so its window is always closed and the verdict comes from raw age.
    await gotoAppSettled(page);
    const ninetyMinutesAgo = minutesAgo(90);
    await seedFreshnessAndRefresh(page, {
      apiSync: { provider: "STAKTRAKR", timestamp: ninetyMinutesAgo },
      cacheRefresh: { provider: "STAKTRAKR", timestamp: ninetyMinutesAgo },
    });
    await expectAllIconsAt(page, "spot-sync-icon--stale");
  });

  test("a successful sync refreshes the icon from expired to fresh", async ({ page }) => {
    // AC: "updates after a successful sync". Proves the post-sync hook in
    // updateLastTimestamps still reaches the icon after the retarget — the
    // default network mock returns a payload generated now.
    await gotoAppSettled(page);
    await seedFreshnessAndRefresh(page, {
      apiSync: { provider: "STAKTRAKR", timestamp: minutesAgo(60 * 48) },
    });
    await expectAllIconsAt(page, "spot-sync-icon--expired");

    const result = await forceSync(page);
    expect(result.results.STAKTRAKR).toBe("success");
    await expectAllIconsAt(page, "spot-sync-icon--fresh");
  });

  test("the freshness class survives a syncing state and never replaces the base class", async ({
    page,
  }) => {
    // The documented trap: the pre-retarget body assigned `className =`, which
    // on a bare dot span was harmless but on these buttons would wipe
    // `.spot-sync-icon` and the `.syncing` class updateSyncButtonStates owns.
    // Two owners of one element's appearance must compose, not overwrite.
    await gotoAppSettled(page);
    await seedFreshnessAndRefresh(page, {
      apiSync: { provider: "STAKTRAKR", timestamp: minutesAgo(5) },
    });

    // updateSyncButtonStates is a script-tag global, not a window property —
    // reach it as a bare identifier inside the page realm.
    await page.evaluate(() => updateSyncButtonStates(true));

    const classes = await page.evaluate(() => [
      ...document.getElementById("syncIconSilver").classList,
    ]);
    expect(classes).toContain("spot-sync-icon");
    expect(classes).toContain("syncing");
    expect(classes).toContain("spot-sync-icon--fresh");
  });

  test("every freshness state is distinct and meets 3:1 contrast in all four themes", async ({
    page,
  }) => {
    // AC: all four themes render every state legibly. Two independent failures
    // are possible and this covers both.
    //
    // DISTINCTNESS — two states resolving to the same colour makes the indicator
    // useless without changing any class, so a class-only assertion is blind to
    // it.
    //
    // CONTRAST — an icon stroke is a graphical object, judged at WCAG 1.4.11
    // Non-text Contrast (3:1), not the 4.5:1 small-text bar. Measuring rather
    // than eyeballing caught two real failures during STRK-291: `--warning` at
    // ~1.4:1 in light and sepia (the documented gotcha), and `--success` at
    // 2.72:1 in sepia (NOT documented anywhere — found only because this test
    // measures every state in every theme rather than the one it was warned
    // about). Both now carry theme-specific overrides in css/styles.css.
    //
    // Colours MUST be resolved through a canvas: getComputedStyle returns
    // `oklch(...)` verbatim for these tokens, and parsing those three numbers as
    // if they were RGB yields silently wrong ratios — during development that
    // mistake reported every theme as failing, including ones that were fine.
    await gotoAppSettled(page);
    await page.evaluate(() => {
      window.__resolveRgb = (css) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
    });

    const contrastRatio = (fg, bg) => {
      const channel = (v) => {
        const n = v / 255;
        return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
      };
      const luminance = ([r, g, b]) =>
        0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const [lighter, darker] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };

    const seeds = {
      fresh: minutesAgo(5),
      stale: minutesAgo(90),
      expired: minutesAgo(60 * 30),
    };

    for (const theme of ["light", "dark", "slate", "sepia"]) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);

      const measured = {};
      for (const [state, timestamp] of Object.entries(seeds)) {
        await seedFreshnessAndRefresh(page, { apiSync: { provider: "STAKTRAKR", timestamp } });
        measured[state] = await page.evaluate(() => {
          const el = document.getElementById("syncIconSilver");
          // Walk up for the first opaque ancestor — the button itself may be
          // transparent, and contrast against rgba(0,0,0,0) is meaningless.
          let surface = getComputedStyle(el).backgroundColor;
          let node = el;
          while (surface === "rgba(0, 0, 0, 0)" && node.parentElement) {
            node = node.parentElement;
            surface = getComputedStyle(node).backgroundColor;
          }
          return {
            token: getComputedStyle(el).color,
            fg: window.__resolveRgb(getComputedStyle(el).color),
            bg: window.__resolveRgb(surface),
          };
        });
      }

      const tokens = Object.values(measured).map((m) => m.token);
      expect(
        new Set(tokens).size,
        `theme ${theme} collapsed states into ${tokens.join(", ")}`
      ).toBe(3);

      for (const [state, m] of Object.entries(measured)) {
        const ratio = contrastRatio(m.fg, m.bg);
        expect(
          ratio,
          `theme ${theme} state ${state} (${m.token}) is ${ratio.toFixed(2)}:1, under the 3:1 non-text bar`
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

// STRK-320 — repaint on tab re-focus. Follow-up to STRK-291: the freshness
// classes are recomputed only when something calls applySpotFreshnessClasses
// (boot, the ten updateSyncButtonStates call sites, the post-sync hook).
// Nothing is driven by the passage of time, so a tab left open across the
// 60-minute or 24-hour boundary kept saying fresh about data it knew was old.
// The fix is a visibilitychange listener in init.js gated on the tab becoming
// visible — deliberately NOT a polling timer (the acceptance criteria forbid
// one, and page.clock.setFixedTime freezes Date without faking timers, so a
// timer-based fix would also be untestable this way).
test.describe("STRK-320 — freshness repaint when the tab becomes visible", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await installBootSyncProbe(page);
  });

  test("a fresh icon repaints to stale on re-focus after crossing the hour, with no sync", async ({
    page,
  }) => {
    await gotoAppSettled(page);
    await seedFreshnessAndRefresh(page, {
      apiSync: { provider: "STAKTRAKR", timestamp: minutesAgo(5) },
    });
    await expectAllIconsAt(page, "spot-sync-icon--fresh");

    // Pin the page clock 90 minutes ahead: the 5-minute-old seed is now 95
    // minutes old. No sync runs and no key is rewritten — only time moved.
    await page.clock.setFixedTime(new Date(Date.now() + 90 * 60 * 1000));

    // Still fresh — this is the bug under test. If this assertion ever fails,
    // something started recomputing on the passage of time alone, and the
    // visibilitychange test below has stopped discriminating anything.
    await expectAllIconsAt(page, "spot-sync-icon--fresh");

    // Simulate the tab coming back into focus. The page under test is already
    // visible, so document.visibilityState === "visible" and the listener's
    // gate passes; dispatchEvent runs the handler synchronously.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expectAllIconsAt(page, "spot-sync-icon--stale");
  });

  test("a visibilitychange to hidden does not repaint", async ({ page }) => {
    // Pins the gate direction: the listener acts when the tab BECOMES visible,
    // not on every visibility flip. Repainting a hidden tab would be harmless
    // but pointless work; asserting fresh-after-hidden-dispatch is what proves
    // the gate exists at all.
    await gotoAppSettled(page);
    await seedFreshnessAndRefresh(page, {
      apiSync: { provider: "STAKTRAKR", timestamp: minutesAgo(5) },
    });
    await page.clock.setFixedTime(new Date(Date.now() + 90 * 60 * 1000));

    await page.evaluate(() => {
      // Shadow the prototype getter on the instance for one dispatch, then
      // remove the shadow so the real getter is back for later assertions.
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      delete document.visibilityState;
    });
    await expectAllIconsAt(page, "spot-sync-icon--fresh");
  });
});

// STRK-333 — freshest-wins must not cost metal coverage.
//
// The publisher builds spot/latest.json from whichever current rows exist and
// skips absent metals (devops/pollers/shared/api-export-v2.js), and exportSpot
// bails only when EVERY row is missing — so a fresh, valid, PARTIAL envelope is
// reachable in production. Ranking purely by generated_at then meant the winner
// could be missing a metal that a slightly older endpoint carried, which either
// failed the whole sync (sole missing selection) or silently left that metal on
// its previous value.
//
// Both endpoints are fetched in parallel anyway, so the runners-up are already
// in memory: a missing metal is filled from the next-freshest envelope that has
// it, at no extra network cost, and only from candidates that already cleared
// the same lenient STRK-189 gate.
test.describe("STRK-333 — spot metal coverage across endpoints", () => {
  // Every case in this block is "serve these two envelopes, sync once, inspect
  // what landed", so the scaffolding is shared rather than repeated four times.
  const FRESH_MINUTES = 5;
  const OLDER_MINUTES = 25;

  /**
   * Serve one envelope per endpoint, boot the app, and run a single forced sync.
   * @param {import('@playwright/test').Page} page - The page under test
   * @param {any} api1Payload - Envelope served by the api1 origin
   * @param {any} api2Payload - Envelope served by the api2 origin
   * @returns {Promise<any>} The syncSpotProvider result
   */
  const syncEndpoints = async (page, api1Payload, api2Payload) => {
    await routeSpotLatest(page, SPOT_LATEST_API1, api1Payload);
    await routeSpotLatest(page, SPOT_LATEST_API2, api2Payload);
    await gotoApp(page);
    return forceSync(page);
  };

  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("a metal missing from the freshest envelope is backfilled from the older passer", async ({
    page,
  }) => {
    const freshIso = minutesAgoIso(FRESH_MINUTES);
    const olderIso = minutesAgoIso(OLDER_MINUTES);

    // Freshest endpoint published without a silver row; the older one is still
    // well inside the lenient gate and carries silver.
    const partial = makeSpotLatest({}, freshIso);
    delete partial.data.xag;
    const result = await syncEndpoints(
      page,
      partial,
      makeSpotLatest({ xag: { price: 44.44 } }, olderIso)
    );
    // Before STRK-333 the winner's missing silver was simply absent from the
    // result map; here it must arrive from the runner-up.
    expect(result.results.STAKTRAKR).toBe("success");
    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("44.44");

    // THE HONESTY ASSERTION. A backfilled metal is recorded with ITS OWN
    // envelope's publication time, never the fresher winner's — stamping a
    // 25-minute-old silver price as 5 minutes old is exactly the
    // badge-disagrees-with-data failure STRK-331 was opened to kill.
    const history = await readSpotHistory(page);
    const rows = history.filter((row) => row.spot === 44.44 && row.metal === "Silver");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.timestamp === toHistoryTimestamp(olderIso))).toBe(true);
    expect(rows.some((row) => row.timestamp === toHistoryTimestamp(freshIso))).toBe(false);
  });

  test("the freshest envelope still wins for a metal both endpoints carry", async ({ page }) => {
    // Guards the backfill against becoming a downgrade: the fill must only ever
    // reach metals the winner OMITS, never overwrite one it already supplied.
    const result = await syncEndpoints(
      page,
      makeSpotLatest({ xag: { price: 55.55 } }, minutesAgoIso(FRESH_MINUTES)),
      makeSpotLatest({ xag: { price: 11.11 } }, minutesAgoIso(OLDER_MINUTES))
    );
    expect(result.results.STAKTRAKR).toBe("success");

    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("55.55");
    const history = await readSpotHistory(page);
    expect(history.some((row) => row.spot === 11.11 && row.metal === "Silver")).toBe(false);
  });

  test("an undated runner-up is never used to backfill a dated winner", async ({ page }) => {
    // Review finding (CodeRabbit + Copilot, independently). An envelope with no
    // parseable generated_at is UNGATED, not merely undated: _checkEnvelopeFreshness
    // returns ok for anything it cannot date, so a legacy or corrupted payload
    // passes the STRK-189 check without being vouched for. It also has no
    // timestamp to record, so a metal taken from it would fall through to the
    // winner's override-free path and be stamped with the winner's FRESH time —
    // the exact overstatement priceTimestamps exists to prevent, and a worse
    // outcome than simply leaving the metal alone.
    const undated = makeSpotLatest({ xag: { price: 77.77 } }, undefined);
    delete undated.generated_at;

    const winner = makeSpotLatest({}, minutesAgoIso(FRESH_MINUTES));
    delete winner.data.xag;
    await syncEndpoints(page, winner, undated);

    // The invariant holds regardless of whether the sync as a whole succeeds:
    // the unvouched price must not reach the display or the history series.
    await expect(page.locator("#spotPriceDisplaySilver")).not.toContainText("77.77");
    const history = await readSpotHistory(page);
    expect(history.some((row) => row.spot === 77.77)).toBe(false);
  });

  test("a price is recorded at its own observation time, not the envelope's publish time", async ({
    page,
  }) => {
    // Review finding (Codex, P1). exportSpot() selects the latest sqld row with
    // NO age cutoff and emits that row's `t` alongside the price, so clearing the
    // envelope's freshness gate does not prove the PRICE is equally fresh — a
    // just-published envelope can carry a much older reading. Recording it at
    // publish time would let a stale price enter the history series as newly
    // minted, which is the same overstatement the backfill guard prevents, just
    // reached by a different route. Live production shape confirms the fields:
    // generated_at 00:38:05 with the xag entry at t=00:30:00Z.
    const publishIso = minutesAgoIso(2);
    const rowIso = minutesAgoIso(40);
    const payload = makeSpotLatest({ xag: { price: 66.66, t: rowIso } }, publishIso);
    const result = await syncEndpoints(page, payload, payload);
    expect(result.results.STAKTRAKR).toBe("success");

    const history = await readSpotHistory(page);
    const rows = history.filter((row) => row.spot === 66.66 && row.metal === "Silver");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.timestamp === toHistoryTimestamp(rowIso))).toBe(true);
    expect(rows.some((row) => row.timestamp === toHistoryTimestamp(publishIso))).toBe(false);
  });
});

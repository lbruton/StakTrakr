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

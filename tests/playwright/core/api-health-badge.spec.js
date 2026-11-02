// STRK-331 — footer API health status: two independent signals.
//
// The badge previously reported endpoint[0] (api1) only, so during a failover
// it advertised stale data while the dashboard above it rendered fresh api2
// prices. The fix splits the signals:
//   - the ages and data-state describe the DATA ON SCREEN — the age of whichever
//     endpoint the fetch path is actually serving (ok fresh / stale);
//   - data-infra and the "API degraded" words describe the INFRASTRUCTURE — ok
//     when all endpoints are healthy, degraded when any is stale or unreachable.
// Selection is freshest-per-feed (STRK-331 follow-up): the data paths serve
// the freshest acceptable payload (_fetchFreshestSpotEnvelope in js/api.js,
// _pickFreshestV2Endpoint in js/retail.js), and the badge reports the same
// smallest age, so it never claims freshness the renderer doesn't have.
//
// Route precedence: per-test page.route registrations are LIFO — they win over
// the extended-test fixture's defaults (api1 all-fresh, api2 always 503). The
// `*` suffix on each pattern matters: fetchApiHealth appends a `?_t=` cache
// buster, so exact-string routes never match.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";
import { makeManifest, makeSpotLatest, makeGoldbackLatest } from "../helpers/mocks/fixtures.js";

const API1 = "https://api.staktrakr.com/data/v2";
const API2 = "https://api2.staktrakr.com/data/v2";

/**
 * Returns an ISO 8601 timestamp the given number of hours in the past.
 * @param {number} hours - Hours to subtract from the current time
 * @returns {string} ISO 8601 timestamp
 */
const hoursAgoIso = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();

/**
 * Returns an ISO 8601 timestamp the given number of minutes in the past.
 * @param {number} minutes - Minutes to subtract from the current time
 * @returns {string} ISO 8601 timestamp
 */
const minutesAgoIso = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();

/**
 * Routes one endpoint's three health-check feeds to envelopes published at
 * `generatedAt`. Goldback stays fresh — it is informational and excluded from
 * both badge signals; keeping it green isolates the signals under test.
 * @param {import('@playwright/test').Page} page
 * @param {string} base - Endpoint base URL (API1 or API2)
 * @param {string} generatedAt - ISO timestamp for manifest + spot envelopes
 * @returns {Promise<void>}
 */
async function routeHealthEndpoints(page, base, generatedAt) {
  /**
   * Builds a Playwright route handler that fulfills with a JSON payload.
   * @param {object} payload - Response body to serialize
   * @returns {(route: import('@playwright/test').Route) => Promise<void>} Route handler
   */
  const fulfillJson = (payload) => (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  await page.route(
    `${base}/manifest.json*`,
    fulfillJson(makeManifest({ generated_at: generatedAt }))
  );
  await page.route(`${base}/spot/latest.json*`, fulfillJson(makeSpotLatest({}, generatedAt)));
  await page.route(`${base}/goldback/latest.json*`, fulfillJson(makeGoldbackLatest()));
}

/**
 * Boots the app and waits for initApiHealth's async fetch to fill the footer
 * badge value span (its static markup ships as "API …").
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('@playwright/test').Locator>} The badge value locator
 */
async function gotoAppAndReadBadge(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  const ages = page.locator("#apiHealthValue");
  await expect(ages).toContainText("Market", { timeout: 15000 });
  return { ages, status: page.locator("#apiHealthBadge") };
}

/** Expects the data signal, the infra signal and the visible infra words to agree. */
async function expectSignals(page, status, data, infra) {
  await expect(status).toHaveAttribute("data-state", data);
  await expect(status).toHaveAttribute("data-infra", infra);
  const words = page.locator("#apiHealthInfra");
  if (infra === "degraded") await expect(words).toHaveText("API degraded");
  else await expect(words).toBeHidden();
}

test.describe("footer health status two-signal model", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("both endpoints fresh: data ok, infra ok, fresh ages", async ({ page }) => {
    const fresh = minutesAgoIso(5);
    await routeHealthEndpoints(page, API1, fresh);
    await routeHealthEndpoints(page, API2, fresh);

    const { ages, status } = await gotoAppAndReadBadge(page);
    await expect(ages).toHaveText(/^Market \S+ ago · Spot \S+ ago$/);
    await expectSignals(page, status, "ok", "ok");
  });

  test("api1 stale-but-200, api2 fresh: fresh age, data ok, infra degraded", async ({ page }) => {
    // 3h is outside both the strict market budget (30m) and the lenient spot
    // gate max(20m × 6, 2h), so the serving endpoint for both feeds is api2.
    await routeHealthEndpoints(page, API1, hoursAgoIso(3));
    await routeHealthEndpoints(page, API2, minutesAgoIso(10));

    const { ages, status } = await gotoAppAndReadBadge(page);
    // Data signal reports the SERVING endpoint (api2): minutes, not hours
    await expect(ages).toHaveText(/^Market \d+m ago · Spot \d+m ago$/);
    // Data on screen is fresh, even though api1 is degraded; the infra signal flags it
    await expectSignals(page, status, "ok", "degraded");
  });

  test("api1 in the 20m–2h window, api2 fresh: both feeds report api2, infra degraded", async ({
    page,
  }) => {
    // api1 25m old passes the LENIENT spot gate. Freshest-per-feed selection
    // (data paths AND status) picks api2's 10m envelope for both feeds, so the
    // ages read fresh while the infra signal flags that api1 lags its budget.
    await routeHealthEndpoints(page, API1, minutesAgoIso(25));
    await routeHealthEndpoints(page, API2, minutesAgoIso(10));

    const { ages, status } = await gotoAppAndReadBadge(page);
    await expect(ages).toHaveText(/^Market 1[012]m ago · Spot 1[012]m ago$/);
    await expectSignals(page, status, "ok", "degraded");
  });

  test("both endpoints stale: data stale, infra degraded, honest stale age", async ({ page }) => {
    const stale = hoursAgoIso(3);
    await routeHealthEndpoints(page, API1, stale);
    await routeHealthEndpoints(page, API2, stale);

    const { ages, status } = await gotoAppAndReadBadge(page);
    await expect(ages).toHaveText(/^Market 3h ago · Spot 3h ago$/);
    await expect(page.locator("#apiHealthLabel")).toHaveText("Prices stale");
    await expectSignals(page, status, "stale", "degraded");
  });

  test("backup unreachable while primary fresh: data ok, infra degraded", async ({ page }) => {
    // The extended-test fixture already serves api1 fresh and api2 as 503 —
    // the default boot state. A dead backup is an infra warning, not a data
    // problem: the data signal stays ok while the infra signal flags it.
    const { ages, status } = await gotoAppAndReadBadge(page);
    // The fixture publishes envelopes at boot time, so the age reads "just now"
    await expect(ages).toHaveText(/^Market (?:just now|\S+ ago) · Spot (?:just now|\S+ ago)$/);
    await expectSignals(page, status, "ok", "degraded");
  });
});

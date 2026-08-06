// STRK-331 — footer API health badge: two independent signals.
//
// The badge previously reported endpoint[0] (api1) only, so during a failover
// it advertised stale data while the dashboard above it rendered fresh api2
// prices. The fix splits the signals:
//   - time + color describe the DATA ON SCREEN — the age of whichever endpoint
//     the fetch path is actually serving (green fresh / orange stale);
//   - the leading icon describes the INFRASTRUCTURE — ✅ all endpoints healthy,
//     ⚠️ any endpoint stale or unreachable.
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
  const badge = page.locator("#apiHealthValue");
  await expect(badge).toContainText("Market", { timeout: 15000 });
  return badge;
}

test.describe("STRK-331 — footer health badge two-signal model", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("both endpoints fresh: green, ✅ icon, fresh ages", async ({ page }) => {
    const fresh = minutesAgoIso(5);
    await routeHealthEndpoints(page, API1, fresh);
    await routeHealthEndpoints(page, API2, fresh);

    const badge = await gotoAppAndReadBadge(page);
    await expect(badge).toHaveText(/^✅ Market \S+ ago · Spot \S+ ago$/);
    await expect(badge).toHaveClass(/shield-badge-value--green/);
  });

  test("api1 stale-but-200, api2 fresh: fresh age, green, ⚠️ icon (today's incident)", async ({
    page,
  }) => {
    // 3h is outside both the strict market budget (30m) and the lenient spot
    // gate max(20m × 6, 2h), so the serving endpoint for both feeds is api2.
    await routeHealthEndpoints(page, API1, hoursAgoIso(3));
    await routeHealthEndpoints(page, API2, minutesAgoIso(10));

    const badge = await gotoAppAndReadBadge(page);
    // Data signal reports the SERVING endpoint (api2): minutes, not hours
    await expect(badge).toHaveText(/^⚠️ Market \d+m ago · Spot \d+m ago$/);
    // Data on screen is fresh → green, even though api1 is degraded
    await expect(badge).toHaveClass(/shield-badge-value--green/);
    // Infra signal flags the degradation the modal explains
    await expect(badge).toContainText("⚠️");
  });

  test("api1 in the 20m–2h window, api2 fresh: both feeds report api2, green, ⚠️ icon", async ({
    page,
  }) => {
    // The live regression seen after v3.35.96 shipped: api1 25m old passes the
    // LENIENT spot gate, so serve-the-first-acceptable selection kept serving
    // it and the badge honestly read orange "25m ago" — the cry-wolf window.
    // v3.35.97 switches selection to freshest-per-feed (data paths AND badge):
    // api2's 10m envelope wins for both feeds, so the badge reads green fresh
    // ages while the icon still flags that api1 is lagging its spot budget.
    await routeHealthEndpoints(page, API1, minutesAgoIso(25));
    await routeHealthEndpoints(page, API2, minutesAgoIso(10));

    const badge = await gotoAppAndReadBadge(page);
    await expect(badge).toHaveText(/^⚠️ Market 1[012]m ago · Spot 1[012]m ago$/);
    await expect(badge).toHaveClass(/shield-badge-value--green/);
  });

  test("both endpoints stale: orange, ⚠️ icon, honest stale age", async ({ page }) => {
    const stale = hoursAgoIso(3);
    await routeHealthEndpoints(page, API1, stale);
    await routeHealthEndpoints(page, API2, stale);

    const badge = await gotoAppAndReadBadge(page);
    await expect(badge).toHaveText(/^⚠️ Market 3h ago · Spot 3h ago$/);
    await expect(badge).toHaveClass(/shield-badge-value--orange/);
  });

  test("backup unreachable while primary fresh: green data, ⚠️ infra icon", async ({ page }) => {
    // The extended-test fixture already serves api1 fresh and api2 as 503 —
    // the default boot state. A dead backup is an infra warning, not a data
    // problem: the age and color stay green while the icon flags it.
    const badge = await gotoAppAndReadBadge(page);
    // The fixture publishes envelopes at boot time, so the age reads "just now"
    await expect(badge).toHaveText(/^⚠️ Market (?:just now|\S+ ago) · Spot (?:just now|\S+ ago)$/);
    await expect(badge).toHaveClass(/shield-badge-value--green/);
  });
});

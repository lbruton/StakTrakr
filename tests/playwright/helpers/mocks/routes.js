/**
 * Shared route installers for StakTrakr Playwright tests.
 *
 * Provides `installStakTrakrNetworkMocks(page, options)` which intercepts
 * all known external API calls with deterministic fixture data.
 */

import {
  makeExchangeRates,
  makeManifest,
  makeRetailLatest,
  makeRetailHistory,
  makeRetailIntraday,
  makeGoldbackLatest,
  makeProviders,
  makeSpotLatest,
  makeSpotDay,
  makeVersion,
  LIGHTWEIGHT_CHARTS_STUB,
  DEFAULT_RETAIL_LATEST,
  DEFAULT_SPOT_LATEST,
} from "./fixtures.js";
import { isAllowed, isDenied, isMocked } from "./audit.js";

const V2_PRIMARY = "https://api.staktrakr.com/data/v2/**";
const V2_FALLBACK = "https://api2.staktrakr.com/data/v2/**";
const EXCHANGE_RATE = "https://open.er-api.com/v6/latest/USD";
const CDN_CHARTS = "https://cdn.jsdelivr.net/npm/lightweight-charts@4/**";
const VERSION_CHECK = "https://www.staktrakr.com/version.json";

/**
 * Install default StakTrakr network mocks on a Playwright page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {object} [options.manifest] — override manifest data
 * @param {object} [options.retailLatest] — map of slug -> price data
 * @param {object} [options.retailHistory] — map of slug -> history rows
 * @param {object} [options.retailIntraday] — map of slug -> intraday rows
 * @param {object} [options.goldback] — override goldback data
 * @param {object} [options.exchangeRates] — override exchange-rate data
 * @param {object} [options.version] — override version-check data
 * @param {object} [options.spotLatest] — map of isoKey -> { price } for spot mocks
 * @param {boolean} [options.denyAll] — if true, abort all external traffic
 */
async function installStakTrakrNetworkMocks(page, options = {}) {
  if (options.denyAll) {
    await page.route("**/*", (route) => route.abort());
    return;
  }

  // 0. Audit catch-all — registered FIRST so it is checked LAST (LIFO).
  // Specific routes registered later win.  We abort denied hosts and
  // fall back for everything else so narrower mocks still get a chance.
  await page.route("https://**/*", async (route) => {
    const url = route.request().url();
    if (isDenied(url)) {
      await route.abort();
    } else if (isMocked(url) || isAllowed(url)) {
      await route.fallback();
    } else {
      await route.abort();
    }
  });

  // 1. Exchange rates
  await page.route(EXCHANGE_RATE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeExchangeRates(options.exchangeRates)),
    });
  });

  // 2. CDN chart library
  await page.route(CDN_CHARTS, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: LIGHTWEIGHT_CHARTS_STUB,
    });
  });

  // 3. Version check
  await page.route(VERSION_CHECK, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeVersion(options.version)),
    });
  });

  // 4. Badge / shield images — return empty SVG to avoid layout shifts
  await page.route("https://img.shields.io/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
  });
  await page.route("https://www.redditstatic.com/**", async (route) => route.abort());

  // 5. V2 primary API
  await page.route(V2_PRIMARY, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/data\/v2\//, "");

    // manifest.json
    if (path === "manifest.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeManifest(options.manifest)),
      });
      return;
    }

    // providers.json
    if (path === "providers.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeProviders()),
      });
      return;
    }

    // goldback/latest.json
    if (path === "goldback/latest.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeGoldbackLatest(options.goldback)),
      });
      return;
    }

    // spot/latest.json
    if (path === "spot/latest.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeSpotLatest(options.spotLatest)),
      });
      return;
    }

    // spot/{isoKey}/{year}/{month}/{day}.json
    const spotDayMatch = path.match(/^spot\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\.json$/);
    if (spotDayMatch) {
      const isoKey = spotDayMatch[1].toLowerCase();
      const spotMap = options.spotLatest || {};
      const price = spotMap[isoKey]?.price || DEFAULT_SPOT_LATEST[isoKey]?.price || 25;
      const metalNames = { xau: "Gold", xag: "Silver", xpt: "Platinum", xpd: "Palladium" };
      const metal = typeof metalNames[isoKey] === "string" ? metalNames[isoKey] : isoKey;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeSpotDay(metal, price)),
      });
      return;
    }

    // retail/{slug}/latest.json
    const latestMatch = path.match(/^retail\/([^/]+)\/latest\.json$/);
    if (latestMatch) {
      const slug = latestMatch[1];
      const optionPrice =
        options.retailLatest &&
        typeof options.retailLatest[slug] === "object" &&
        options.retailLatest[slug];
      const defaultPrice =
        DEFAULT_RETAIL_LATEST &&
        typeof DEFAULT_RETAIL_LATEST[slug] === "object" &&
        DEFAULT_RETAIL_LATEST[slug];
      const prices = optionPrice || defaultPrice || {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeRetailLatest(slug, prices)),
      });
      return;
    }

    // retail/{slug}/history-30d.json
    const historyMatch = path.match(/^retail\/([^/]+)\/history-30d\.json$/);
    if (historyMatch) {
      const slug = historyMatch[1];
      const rows = options.retailHistory && options.retailHistory[slug];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeRetailHistory(rows)),
      });
      return;
    }

    // retail/{slug}/intraday.json
    const intradayMatch = path.match(/^retail\/([^/]+)\/intraday\.json$/);
    if (intradayMatch) {
      const slug = intradayMatch[1];
      const rows = options.retailIntraday && options.retailIntraday[slug];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeRetailIntraday(rows)),
      });
      return;
    }

    // Default 404 for unhandled v2 paths
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  // 6. V2 fallback API — always 503
  await page.route(V2_FALLBACK, async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
}

export {
  installStakTrakrNetworkMocks,
  V2_PRIMARY,
  V2_FALLBACK,
  EXCHANGE_RATE,
  CDN_CHARTS,
  VERSION_CHECK,
};

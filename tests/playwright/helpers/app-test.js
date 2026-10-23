/**
 * Base Playwright fixture for every StakTrakr spec.
 *
 * Its `page` fixture makes every app-shell navigation wait for boot to finish and
 * installs no network mocks. Specs that load the app shell import
 * `mocks/extended-test.js`, which extends this fixture with the default mocks.
 * With `COVERAGE=1` it also writes one coverage record per test (see `coverage.js`).
 */

import { test as base, expect } from "@playwright/test";
import {
  RAW_COVERAGE_DIR,
  REPO_ROOT,
  appCoverageEntries,
  isCoverageEnabled,
  rawRecordFor,
  writeRawRecord,
} from "./coverage.js";

const COVERAGE = isCoverageEnabled();
// Pages that collect coverage and are still open; a shared page outlives one test.
const coveredPages = new Set();
const APP_SHELL_PATHS = new Set(["/", "/index.html"]);
// Precise coverage slows script execution, so boot gets more time when it is on.
const BOOT_TIMEOUT_MS = COVERAGE ? 30000 : 15000;

/**
 * Wraps page.goto and page.reload so an app-shell navigation resolves only after
 * init.js sets window.appListenersReady. Boot finishes in a deferred timer, so a
 * test that starts at DOMContentLoaded races it once workers share the CPU.
 * Pass `{ waitForApp: false }` to observe the page before boot completes.
 * @param {import('@playwright/test').Page} page - Page under test.
 * @param {string} baseURL - App origin; navigations elsewhere never wait for boot.
 */
function awaitBootOnNavigation(page, baseURL) {
  const appOrigin = new URL(baseURL).origin;
  const settle = async (response, options) => {
    if (options.waitForApp === false) return response;
    const target = new URL(page.url());
    if (target.origin !== appOrigin || !APP_SHELL_PATHS.has(target.pathname)) return response;
    await page.waitForFunction(() => window.appListenersReady === true, null, {
      timeout: BOOT_TIMEOUT_MS,
    });
    return response;
  };
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (url, options = {}) => {
    const { waitForApp, ...rest } = options;
    return settle(await goto(url, rest), { waitForApp });
  };
  page.reload = async (options = {}) => {
    const { waitForApp, ...rest } = options;
    return settle(await reload(rest), { waitForApp });
  };
}

/**
 * Gives a page made outside the `page` fixture (`browser.newPage()`,
 * `context.newPage()`) the same per-page setup the fixture applies.
 * @param {import('@playwright/test').Page} page - Page the spec created itself.
 * @param {string} [baseURL] - App origin; defaults to the project's `use.baseURL`.
 */
async function prepareAppPage(page, baseURL = base.info().project.use.baseURL) {
  awaitBootOnNavigation(page, baseURL);
  if (!COVERAGE) return;
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  coveredPages.add(page);
  page.once("close", () => coveredPages.delete(page));
}

/**
 * Stops coverage on a page and returns its app entries without `source`; the merge
 * reads the served file from the repository. A page that stays open for the next
 * test (`restart`) starts collecting again.
 * @param {import('@playwright/test').Page} page - Page collecting coverage.
 * @param {string} baseURL - App origin.
 * @param {boolean} restart - Start a new collection after stopping.
 * @returns {Promise<object[]>}
 */
async function takeCoverage(page, baseURL, restart) {
  coveredPages.delete(page);
  if (page.isClosed()) return [];
  const entries = appCoverageEntries(await page.coverage.stopJSCoverage(), baseURL);
  if (restart) {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    coveredPages.add(page);
  }
  return entries.map(({ url, functions }) => ({ url, functions }));
}

const test = base.extend({
  // `page` depends on this fixture, so its teardown adds the page's entries first.
  appCoverage: [
    async ({ baseURL }, use, testInfo) => {
      const entries = [];
      await use(entries);
      if (!COVERAGE) return;
      for (const page of [...coveredPages])
        entries.push(...(await takeCoverage(page, baseURL, true)));
      writeRawRecord(RAW_COVERAGE_DIR, rawRecordFor(testInfo, REPO_ROOT, entries));
    },
    { auto: true },
  ],
  page: async ({ page, baseURL, appCoverage }, use) => {
    await prepareAppPage(page, baseURL);
    await use(page);
    if (COVERAGE) appCoverage.push(...(await takeCoverage(page, baseURL, false)));
  },
});

export { test, expect, prepareAppPage };

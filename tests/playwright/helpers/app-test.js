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
// Entries taken before a test closed a page or navigated it, written with that test's record.
const takenEntries = [];
const instrumentedPages = new WeakSet();
const wrappedContexts = new WeakSet();
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
  await instrumentPage(page, baseURL);
}

/**
 * Starts coverage on a page once, and takes it before the test closes or navigates
 * the page.
 * @param {import('@playwright/test').Page} page - Page to instrument.
 * @param {string} baseURL - App origin.
 */
async function instrumentPage(page, baseURL) {
  if (!COVERAGE || instrumentedPages.has(page)) return;
  instrumentedPages.add(page);
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  coveredPages.add(page);
  page.once("close", () => coveredPages.delete(page));
  // Coverage cannot be read from a closed page, and the scripts of a document left
  // behind drop out of the next read, so take it first.
  const takeBefore = (target, method, restart) => {
    const call = target[method].bind(target);
    target[method] = async (...args) => {
      if (coveredPages.has(page))
        takenEntries.push(...(await takeCoverage(page, baseURL, restart)));
      return call(...args);
    };
  };
  takeBefore(page, "close", false);
  takeBefore(page.context(), "close", false);
  takeBefore(page, "goto", true);
  takeBefore(page, "reload", true);
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

/**
 * While a test runs, instruments every page it creates through `browser.newContext()`,
 * `browser.newPage()` or a wrapped context's `newPage()`, so a second device or tab
 * reports coverage too. Coverage only: the boot wait stays opt-in.
 * @param {import('@playwright/test').Browser} browser - Worker browser.
 * @param {string} baseURL - App origin.
 * @param {Set<import('@playwright/test').Page>} owned - Collects the pages created.
 * @returns {{wrapContext: Function, restore: Function}}
 */
function instrumentNewPages(browser, baseURL, owned) {
  const track = async (page) => {
    await instrumentPage(page, baseURL);
    owned.add(page);
    return page;
  };
  const wrapContext = (context) => {
    if (wrappedContexts.has(context)) return context;
    wrappedContexts.add(context);
    const newPage = context.newPage.bind(context);
    context.newPage = async (...args) => track(await newPage(...args));
    return context;
  };
  const newContext = browser.newContext;
  const newPage = browser.newPage;
  browser.newContext = async (...args) => wrapContext(await newContext.apply(browser, args));
  browser.newPage = async (...args) => track(await newPage.apply(browser, args));
  return {
    wrapContext,
    restore: () => {
      browser.newContext = newContext;
      browser.newPage = newPage;
    },
  };
}

const test = base.extend({
  // `page` depends on this fixture, so its teardown adds the page's entries first.
  appCoverage: [
    async ({ baseURL, browser }, use, testInfo) => {
      const entries = [];
      const owned = new Set();
      // Drop entries a previous test's afterAll left behind; they belong to no test.
      takenEntries.length = 0;
      const pages = COVERAGE ? instrumentNewPages(browser, baseURL, owned) : null;
      try {
        await use({ entries, wrapContext: pages ? pages.wrapContext : (context) => context });
      } finally {
        pages?.restore();
      }
      if (!COVERAGE) return;
      entries.push(...takenEntries.splice(0));
      for (const page of owned) entries.push(...(await takeCoverage(page, baseURL, false)));
      // What remains is a page shared across tests (a serial group's beforeAll page).
      for (const page of [...coveredPages])
        entries.push(...(await takeCoverage(page, baseURL, true)));
      writeRawRecord(RAW_COVERAGE_DIR, rawRecordFor(testInfo, REPO_ROOT, entries));
    },
    { auto: true },
  ],
  page: async ({ page, baseURL, appCoverage }, use) => {
    await prepareAppPage(page, baseURL);
    appCoverage.wrapContext(page.context());
    await use(page);
    if (COVERAGE) appCoverage.entries.push(...(await takeCoverage(page, baseURL, false)));
  },
});

export { test, expect, prepareAppPage };

/**
 * Base Playwright fixture for every StakTrakr spec.
 *
 * Its `page` fixture makes every app-shell navigation wait for boot to finish and
 * installs no network mocks. Specs that load the app shell import
 * `mocks/extended-test.js`, which extends this fixture with the default mocks.
 */

import { test as base, expect } from "@playwright/test";

const APP_SHELL_PATHS = new Set(["/", "/index.html"]);
const BOOT_TIMEOUT_MS = 15000;

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
}

const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await prepareAppPage(page, baseURL);
    await use(page);
  },
});

export { test, expect, prepareAppPage };

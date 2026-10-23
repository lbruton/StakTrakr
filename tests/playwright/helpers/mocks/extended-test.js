/**
 * Extended Playwright test fixture with automatic StakTrakr network mocks.
 *
 * Import this instead of `@playwright/test` for specs that navigate to the
 * app shell (`/index.html`). The fixture installs default network mocks before
 * each test runs, and makes every app-shell navigation wait for boot to finish.
 *
 * Per-spec overrides should register AFTER this fixture (they win by LIFO
 * precedence in Playwright's route matching). Use `route.fallback()` only
 * when you intentionally want to delegate back to the default handler.
 */

import { test as base, expect } from "@playwright/test";
import { installStakTrakrNetworkMocks } from "./routes.js";

const APP_SHELL_PATHS = new Set(["/", "/index.html"]);
const BOOT_TIMEOUT_MS = 15000;

/**
 * Wraps page.goto and page.reload so an app-shell navigation resolves only after
 * init.js sets window.appListenersReady. Boot finishes in a deferred timer, so a
 * test that starts at DOMContentLoaded races it once workers share the CPU.
 * Pass `{ waitForApp: false }` to observe the page before boot completes.
 * @param {import('@playwright/test').Page} page - Page under test.
 */
function awaitBootOnNavigation(page) {
  const settle = async (response, options) => {
    if (options.waitForApp === false) return response;
    if (!APP_SHELL_PATHS.has(new URL(page.url()).pathname)) return response;
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

const test = base.extend({
  page: async ({ page }, use) => {
    await installStakTrakrNetworkMocks(page);
    awaitBootOnNavigation(page);
    await use(page);
  },
});

export { test, expect };

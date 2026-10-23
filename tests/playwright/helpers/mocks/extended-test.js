/**
 * Extended Playwright test fixture with automatic StakTrakr network mocks.
 *
 * Import this instead of `@playwright/test` for specs that navigate to the
 * app shell (`/index.html`). It extends `../app-test.js`, so app-shell
 * navigations also wait for boot to finish.
 *
 * Per-spec overrides should register AFTER this fixture (they win by LIFO
 * precedence in Playwright's route matching). Use `route.fallback()` only
 * when you intentionally want to delegate back to the default handler.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { test as appTest, expect, prepareAppPage } from "../app-test.js";
import { REPO_ROOT } from "../coverage.js";
import { installStakTrakrNetworkMocks } from "./routes.js";

const STATIC_PATH = /^\/(?:js|css|vendor|data)\/[^?#]+\.(?:js|css)$/;
const CONTENT_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
// One copy per worker: a file edited during a run is not read again until its worker restarts.
const staticFiles = new Map();

/**
 * Reads a static app file once per worker.
 * @param {string} pathname - URL path such as `/js/init.js`.
 * @returns {Buffer|null} File bytes, or null when the file does not exist.
 */
function readStaticFile(pathname) {
  if (!staticFiles.has(pathname)) {
    let body = null;
    try {
      body = readFileSync(path.join(REPO_ROOT, pathname));
    } catch {
      body = null;
    }
    staticFiles.set(pathname, body);
  }
  return staticFiles.get(pathname);
}

/**
 * Serves the app's scripts and stylesheets from worker memory. Parallel workers share one
 * `python3 -m http.server`, and queueing on it slows every boot. A missing file falls back
 * to the server, so it still answers 404.
 * @param {import('@playwright/test').Page} page - Page under test.
 * @param {string} baseURL - App origin.
 */
async function serveStaticFromMemory(page, baseURL) {
  const origin = new URL(baseURL).origin;
  await page.route(
    (url) => url.origin === origin && STATIC_PATH.test(url.pathname),
    (route) => {
      const { pathname } = new URL(route.request().url());
      const body = readStaticFile(pathname);
      if (!body) return route.fallback();
      return route.fulfill({
        status: 200,
        body,
        contentType: CONTENT_TYPES[path.extname(pathname)],
      });
    }
  );
}

const test = appTest.extend({
  page: async ({ page, baseURL }, use) => {
    await serveStaticFromMemory(page, baseURL);
    await installStakTrakrNetworkMocks(page);
    await use(page);
  },
});

export { test, expect, prepareAppPage };

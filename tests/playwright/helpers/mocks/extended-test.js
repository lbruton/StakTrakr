/**
 * Extended Playwright test fixture with automatic StakTrakr network mocks.
 *
 * Import this instead of `@playwright/test` for specs that navigate to the
 * app shell (`/index.html`). The fixture installs default network mocks before
 * each test runs.
 *
 * Per-spec overrides should register AFTER this fixture (they win by LIFO
 * precedence in Playwright's route matching). Use `route.fallback()` only
 * when you intentionally want to delegate back to the default handler.
 */

const { test: base, expect } = require("@playwright/test");
const { installStakTrakrNetworkMocks } = require("./routes.js");

const test = base.extend({
  page: async ({ page }, use) => {
    await installStakTrakrNetworkMocks(page);
    await use(page);
  },
});

module.exports = { test, expect };

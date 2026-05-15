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

import { test as base, expect } from "@playwright/test";
import { installStakTrakrNetworkMocks } from "./routes.js";

const test = base.extend({
  page: async ({ page }, use) => {
    await installStakTrakrNetworkMocks(page);
    await use(page);
  },
});

export { test, expect };

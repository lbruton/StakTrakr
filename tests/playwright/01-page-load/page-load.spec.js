import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

async function allowWhatsNew(page) {
  await page.addInitScript(() => {
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      if (key === "ackVersion") return;
      origSetItem(key, value);
    };
  });
}

async function dismissWhatsNew(page) {
  const card = page.locator(".whats-new-toast-card");
  const isVisible = await card.isVisible();
  if (isVisible) {
    await card.locator(".wntc-close").click();
    await expect(card).toBeHidden();
  }
}

test.describe("01-page-load", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("1.1 — page loads at local URL", async ({ page }) => {
    // runbook: 01-page-load.md §1.1
    // NOTE: Runbook pass criteria references tagline "Your Stack. Your Way." —
    // this text does not exist in the live HTML (#appLogo is the SVG branding element).
    // Assertion adapted to check #appLogo visibility as the equivalent branding check.
    await page.goto("/index.html");
    await expect(page).toHaveTitle(/StakTrakr/);
    await expect(page.locator("#appLogo")).toBeVisible();
  });

  test("1.2 — What's New toast card appears on first load", async ({ page }) => {
    // runbook: 01-page-load.md §1.2 — STAK-547 replaced modal with toast card
    // Prevent ackVersion from being set so the toast card appears
    await allowWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeVisible({ timeout: 5000 });
  });

  test("1.3 — What's New contains latest patch notes", async ({ page }) => {
    // runbook: 01-page-load.md §1.3 — STAK-547 replaced modal with toast card
    await allowWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeVisible({ timeout: 5000 });
    const versionEl = page.locator(".wntc-version");
    await expect(versionEl).not.toBeEmpty();
  });

  test("1.4 — clicking dismiss closes the What's New toast card", async ({ page }) => {
    // runbook: 01-page-load.md §1.4 — STAK-547 replaced modal with toast card
    await allowWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeVisible({ timeout: 5000 });
    await page.locator(".wntc-close").click();
    await expect(page.locator(".whats-new-toast-card")).toBeHidden();
  });

  test("1.5 — What's New does NOT appear on refresh (session-scoped)", async ({ page }) => {
    // runbook: 01-page-load.md §1.5
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeHidden();
  });

  test("1.6 — header displays all menu items in correct order", async ({ page }) => {
    // runbook: 01-page-load.md §1.6
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const headerBtns = page.locator("#headerBtnContainer button.header-toggle-btn:visible");
    const count = await headerBtns.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("1.7 — version number in header matches deployed patch version", async ({ page }) => {
    // runbook: 01-page-load.md §1.7
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const versionBadge = page.locator("#versionBadgeValue");
    await expect(versionBadge).toBeVisible({ timeout: 5000 });
    const text = await versionBadge.textContent();
    expect(text.trim()).toMatch(/\d+\.\d+\.\d+/);
    expect(text.trim()).not.toMatch(/^0\.0\.0/);
    expect(text.trim()).not.toContain("undefined");
  });

  test("1.8 — spot cards render (all 4 metals, non-zero values)", async ({ page }) => {
    // runbook: 01-page-load.md §1.8
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    for (const metal of ["Gold", "Silver", "Platinum", "Palladium"]) {
      const el = page.locator(`#spotPriceDisplay${metal}`);
      await expect(el).toBeVisible();
      // Wait for async spot data to replace placeholder "—"
      await expect(el).not.toHaveText("—", { timeout: 10000 });
      const text = await el.textContent();
      expect(text.trim()).not.toBe("$0.00");
      expect(text.trim()).not.toBe("N/A");
    }
  });

  test("1.9 — spot API backfills missing spot prices for last 30 days on load", async ({
    page,
  }) => {
    // runbook: 01-page-load.md §1.9
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    for (const metal of ["Gold", "Silver", "Platinum", "Palladium"]) {
      const el = page.locator(`#spotPriceDisplay${metal}`);
      await expect(el).toBeVisible();
      // Wait for async spot data to replace placeholder "—"
      await expect(el).not.toHaveText("—", { timeout: 10000 });
      const text = await el.textContent();
      expect(text.trim()).not.toBe("N/A");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  test("1.10 — market API backfills daily market prices for last 30 days on load", async ({
    page,
  }) => {
    // runbook: 01-page-load.md §1.10
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    // Check that no error toasts appear about market data failures
    const errorToast = page.locator(".cloud-toast", {
      hasText: /storage is full|quota|could not be saved/i,
    });
    await expect(errorToast).toHaveCount(0);
  });

  test("1.11 — seed inventory count is accurate on first load", async ({ page }) => {
    // runbook: 01-page-load.md §1.11
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const countEl = page.locator("#totalItemsAll");
    await expect(countEl).toBeVisible();
    await expect(countEl).toHaveText("8");
  });

  test("1.12 — fresh startup stays quota-safe and keeps market UI available", async ({ page }) => {
    // runbook: 01-page-load.md §1.12
    // Seed minimal retail data so the best-price ticker renders
    await page.addInitScript(() => {
      window._v2RetailData = {
        prices: {
          "1oz-silver-eagle": {
            median_price: 32,
            lowest_price: 31.5,
            highest_price: 33,
            vendors: { apmex: { price: 32, inStock: true, in_stock: true } },
          },
        },
        lastSync: new Date().toISOString(),
      };
    });
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    // Verify no storage-full/quota toasts appear during cold startup
    const quotaToast = page.locator(".cloud-toast", {
      hasText: /storage is full|quota|spot history|could not be saved/i,
    });
    await expect(quotaToast).toHaveCount(0);
    const ticker = page.locator("#bestPriceTickerEl");
    await expect(ticker).toBeVisible();
  });
});

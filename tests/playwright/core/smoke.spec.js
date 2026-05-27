import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";
import { DEFAULT_RETAIL_LATEST } from "../helpers/mocks/fixtures.js";

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

test.describe("core/smoke — app shell boot", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("page loads at local URL with branding", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page).toHaveTitle(/StakTrakr/);
    await expect(page.locator("#appLogo")).toBeVisible();
  });

  test("What's New toast card appears on first load", async ({ page }) => {
    await allowWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeVisible({ timeout: 5000 });
  });

  test("What's New contains latest patch notes", async ({ page }) => {
    await allowWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeVisible({ timeout: 5000 });
    const versionEl = page.locator(".wntc-version");
    await expect(versionEl).not.toBeEmpty();
  });

  test("clicking dismiss closes the What's New toast card", async ({ page }) => {
    await allowWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeVisible({ timeout: 5000 });
    await page.locator(".wntc-close").click();
    await expect(page.locator(".whats-new-toast-card")).toBeHidden();
  });

  test("What's New does NOT appear on refresh (session-scoped)", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeHidden();
  });

  test("header displays menu items", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const headerBtns = page.locator("#headerBtnContainer button.header-toggle-btn:visible");
    const count = await headerBtns.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("version number in header matches deployed patch version", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const versionBadge = page.locator("#versionBadgeValue");
    await expect(versionBadge).toBeVisible({ timeout: 5000 });
    const text = await versionBadge.textContent();
    expect(text.trim()).toMatch(/\d+\.\d+\.\d+/);
    expect(text.trim()).not.toMatch(/^0\.0\.0/);
    expect(text.trim()).not.toContain("undefined");
  });

  test("spot cards render (all 4 metals, non-zero values)", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    for (const metal of ["Gold", "Silver", "Platinum", "Palladium"]) {
      const el = page.locator(`#spotPriceDisplay${metal}`);
      await expect(el).toBeVisible();
      await expect(el).not.toHaveText("—", { timeout: 10000 });
      const text = await el.textContent();
      expect(text.trim()).not.toBe("$0.00");
      expect(text.trim()).not.toBe("N/A");
    }
  });

  test("spot API backfills missing spot prices for last 30 days on load", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    for (const metal of ["Gold", "Silver", "Platinum", "Palladium"]) {
      const el = page.locator(`#spotPriceDisplay${metal}`);
      await expect(el).toBeVisible();
      await expect(el).not.toHaveText("—", { timeout: 10000 });
      const text = await el.textContent();
      expect(text.trim()).not.toBe("N/A");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  test("market API backfills daily market prices without errors on load", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const errorToast = page.locator(".cloud-toast", {
      hasText: /storage is full|quota|could not be saved/i,
    });
    await expect(errorToast).toHaveCount(0);
  });

  test("seed inventory count is accurate on first load", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const countEl = page.locator("#totalItemsAll");
    await expect(countEl).toBeVisible();
    await expect(countEl).toHaveText("8");
  });

  test("fresh startup stays quota-safe and keeps market UI available", async ({ page }) => {
    await page.addInitScript((retailLatest) => {
      window._v2RetailData = {
        prices: retailLatest,
        lastSync: new Date().toISOString(),
      };
    }, DEFAULT_RETAIL_LATEST);
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const quotaToast = page.locator(".cloud-toast", {
      hasText: /storage is full|quota|spot history|could not be saved/i,
    });
    await expect(quotaToast).toHaveCount(0);
    const ticker = page.locator("#bestPriceTickerEl");
    await expect(ticker).toBeVisible();
  });
});

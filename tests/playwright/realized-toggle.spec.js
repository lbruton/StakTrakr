import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "./helpers/seed.js";

async function openAppearanceSettings(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("site"));
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator("#settingsPanel_site")).toBeVisible();
}

test.describe("realized-toggle — STAK-436 Layout toggle migration", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await openAppearanceSettings(page);
  });

  test("RT.1 — Layout card shows Show Realized G/L yes/no toggle", async ({ page }) => {
    const layoutFieldset = page
      .locator("#layoutSectionConfigContainer")
      .locator("xpath=ancestor::div[contains(@class,'settings-fieldset')][1]");
    await expect(layoutFieldset).toContainText("Layout");
    await expect(page.locator("#settingsShowRealizedToggle")).toBeVisible();
    await expect(
      page.locator('#settingsShowRealizedToggle .chip-sort-btn[data-val="yes"]')
    ).toHaveText("Yes");
    await expect(
      page.locator('#settingsShowRealizedToggle .chip-sort-btn[data-val="no"]')
    ).toHaveText("No");
  });

  test("RT.2 — clicking No hides realized rows on summary cards", async ({ page }) => {
    await page.locator('#settingsShowRealizedToggle .chip-sort-btn[data-val="no"]').click();

    const silverRealizedRow = page.locator("#realizedGainLossSilver").locator("xpath=..");
    await expect(silverRealizedRow).toBeHidden();

    const allMetalsRealizedRow = page.locator("#realizedGainLossAll").locator("xpath=..");
    await expect(allMetalsRealizedRow).toBeHidden();
  });

  test("RT.3 — clicking Yes shows realized rows on summary cards", async ({ page }) => {
    await page.locator('#settingsShowRealizedToggle .chip-sort-btn[data-val="no"]').click();
    await page.locator('#settingsShowRealizedToggle .chip-sort-btn[data-val="yes"]').click();

    const silverRealizedRow = page.locator("#realizedGainLossSilver").locator("xpath=..");
    await expect(silverRealizedRow).toBeVisible();

    const allMetalsRealizedRow = page.locator("#realizedGainLossAll").locator("xpath=..");
    await expect(allMetalsRealizedRow).toBeVisible();
  });

  test("RT.4 — No selection persists after page refresh", async ({ page }) => {
    await page.locator('#settingsShowRealizedToggle .chip-sort-btn[data-val="no"]').click();
    await page.reload();
    await openAppearanceSettings(page);

    await expect(
      page.locator('#settingsShowRealizedToggle .chip-sort-btn[data-val="no"]')
    ).toHaveClass(/active/);
    await expect(page.locator("#realizedGainLossSilver").locator("xpath=..")).toBeHidden();
  });

  test("RT.5 — Summary Totals card no longer exists", async ({ page }) => {
    await expect(page.getByText("Summary Totals", { exact: true })).toHaveCount(0);
    await expect(page.locator("#settingsShowRealized")).toHaveCount(0);
  });
});

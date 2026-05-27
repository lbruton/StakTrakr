import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

// Settings > Currency tab — Playwright tests

async function openCurrencySettings(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("currency"));

  const settingsModal = page.locator("#settingsModal");
  await expect(settingsModal).toBeVisible();
  await expect(page.locator("#settingsPanel_currency")).toBeVisible();
}

test.describe("settings-currency — STAK-570 merged Currency tab", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.showSettingsModal === "function");
    await page.waitForTimeout(300);
    await openCurrencySettings(page);
  });

  test("0.5.1 — Goldback nav item is absent from the settings sidebar", async ({ page }) => {
    await expect(page.locator('.settings-nav-item[data-section="goldback"]')).toHaveCount(0);
    await expect(page.locator("#settingsPanel_goldback")).toHaveCount(0);
  });

  test("0.5.2 — Currency tab shows a 4-option Goldback pricing source selector", async ({
    page,
  }) => {
    const sourceGroup = page.locator("#settingsPanel_currency #settingsGoldbackSource");
    await expect(sourceGroup).toBeVisible();
    await expect(sourceGroup.locator(".gb-source-btn")).toHaveCount(4);
    await expect(sourceGroup.locator('.gb-source-btn[data-val="off"]')).toContainText("Off");
    await expect(sourceGroup.locator('.gb-source-btn[data-val="api"]')).toContainText(
      "StakTrakr API"
    );
    await expect(sourceGroup.locator('.gb-source-btn[data-val="spot"]')).toContainText(
      "Estimate from Spot"
    );
    await expect(sourceGroup.locator('.gb-source-btn[data-val="manual"]')).toContainText("Manual");
  });

  test("0.5.3 — pricing source changes persist to localStorage", async ({ page }) => {
    const manualButton = page.locator(
      '#settingsPanel_currency #settingsGoldbackSource .gb-source-btn[data-val="manual"]'
    );
    await expect(manualButton).toBeVisible();
    await manualButton.click();

    await expect(manualButton).toHaveClass(/active/);

    const storedSource = await page.evaluate(() => {
      const rawValue = localStorage.getItem("goldback-pricing-source");
      if (rawValue == null) return rawValue;
      try {
        return JSON.parse(rawValue);
      } catch {
        return rawValue;
      }
    });
    expect(storedSource).toBe("manual");
  });

  test("0.5.4 — conditional inputs show and hide for spot, manual, and off modes", async ({
    page,
  }) => {
    const sourceGroup = page.locator("#settingsPanel_currency #settingsGoldbackSource");
    const spotModifierGroup = page.locator("#settingsPanel_currency #goldbackSpotModifierGroup");
    const manualInputGroup = page.locator("#settingsPanel_currency #goldbackManualInputGroup");
    const spotButton = sourceGroup.locator('.gb-source-btn[data-val="spot"]');
    const manualButton = sourceGroup.locator('.gb-source-btn[data-val="manual"]');
    const offButton = sourceGroup.locator('.gb-source-btn[data-val="off"]');

    await expect(sourceGroup).toBeVisible();

    await expect(spotButton).toBeVisible();
    await spotButton.click();
    await expect(spotModifierGroup).toBeVisible();
    await expect(manualInputGroup).toBeHidden();

    await expect(manualButton).toBeVisible();
    await manualButton.click();
    await expect(manualInputGroup).toBeVisible();
    await expect(spotModifierGroup).toBeHidden();

    await expect(offButton).toBeVisible();
    await offButton.click();
    await expect(spotModifierGroup).toBeHidden();
    await expect(manualInputGroup).toBeHidden();
  });

  test("0.5.5 — denomination table in Currency tab is read-only text", async ({ page }) => {
    const currencyPanel = page.locator("#settingsPanel_currency");
    const table = currencyPanel.locator("#goldbackPriceTable");

    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).not.toHaveCount(0);
    await expect(table.locator('input, button[type="submit"], button.save-prices')).toHaveCount(0);
  });

  test("0.5.6 — Header currency button toggle is absent from the Currency tab", async ({
    page,
  }) => {
    await expect(page.locator("#settingsPanel_currency #settingsHeaderCurrencyBtn")).toHaveCount(0);
  });

  test("0.5.7 — History button in Currency tab opens the Goldback history modal", async ({
    page,
  }) => {
    const historyButton = page.locator("#settingsPanel_currency #goldbackHistoryBtn");
    await expect(historyButton).toBeVisible();
    await historyButton.click();

    await expect(page.locator("#goldbackHistoryModal")).toBeVisible();
  });
});

import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const openSettingsModal = async (page) => {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal());
  await expect(page.locator("#settingsModal")).toBeVisible();
};

const openSettingsSection = async (page, section, panelId) => {
  await page.evaluate((name) => window.switchSettingsSection(name), section);
  await expect(page.locator(panelId)).toBeVisible();
};

test.describe("core/settings-search-images", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.switchSettingsSection === "function"
    );
  });

  test("Search settings live in Filter Chips and fuzzy autocomplete persists", async ({ page }) => {
    await openSettingsModal(page);
    await expect(page.locator('.settings-nav-item[data-section="search"]')).toHaveCount(0);
    await openSettingsSection(page, "grouping", "#settingsPanel_grouping");

    const panel = page.locator("#settingsPanel_grouping");
    await expect(panel.locator('.settings-fieldset-title:has-text("Search")')).toBeVisible();
    await expect(panel.locator("#settingsFuzzyAutocomplete")).toBeVisible();

    await page.evaluate(() => localStorage.setItem("ff_migration_fuzzy_autocomplete", "1"));
    await panel.locator('#settingsFuzzyAutocomplete .chip-sort-btn[data-val="no"]').click();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("featureFlags") || "{}").FUZZY_AUTOCOMPLETE
      )
    ).toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("featureFlags") || "{}").FUZZY_AUTOCOMPLETE
      )
    ).toBe(false);
  });

  test("Custom Numista search patterns can be added and persist", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "grouping", "#settingsPanel_grouping");

    const panel = page.locator("#settingsPanel_grouping");
    await panel.locator("#numistaRulePatternInput").fill("\\bcore-pattern\\b");
    await panel.locator("#numistaRuleReplacementInput").fill('"Core Pattern" Bullion');
    await panel.locator("#numistaRuleIdInput").fill("9797");
    await panel.locator("#addNumistaRuleBtn").click();

    await expect(panel.locator("#customRuleTableContainer")).toContainText("\\bcore-pattern\\b");

    await page.reload({ waitUntil: "domcontentloaded" });
    await openSettingsModal(page);
    await openSettingsSection(page, "grouping", "#settingsPanel_grouping");
    await expect(page.locator("#customRuleTableContainer")).toContainText("\\bcore-pattern\\b");
  });

  test("Images settings expose the rule form and upload controls", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    await expect(page.locator("#imageStorageStats")).not.toBeVisible();

    const newRuleBtn = page.locator("#newPatternRuleBtn");
    await expect(newRuleBtn).toBeVisible();
    await newRuleBtn.click();

    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();
    await expect(page.locator("#patternRuleObverseUploadBtn")).toHaveCount(1);
    await expect(page.locator("#patternRuleReverseUploadBtn")).toHaveCount(1);
    await expect(page.locator("#patternRuleSwapBtn")).toHaveCount(1);
  });
});

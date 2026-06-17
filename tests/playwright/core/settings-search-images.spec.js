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

  // Characterization lock for STRK-195: pins the #addPatternRuleBtn handler's
  // observable behavior (keyword→regex compile, image requirement, rule add,
  // form reset/collapse, persistence) before it is decomposed into helpers.
  test("Image pattern rule (keywords + image) adds rule, resets form, and persists", async ({
    page,
  }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const before = await page.evaluate(() => window.NumistaLookup.getCustomRules().length);

    const toggleBtn = page.locator("#newPatternRuleBtn");
    await toggleBtn.click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();

    await page.locator("#patternRulePattern").fill("morgan, peace");
    await page
      .locator("#patternRuleObverse")
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await expect(page.locator("#patternRuleObverseName")).toHaveText("test-obverse.png");

    await page.locator("#addPatternRuleBtn").click();

    // Keywords mode compiles comma-separated terms into an alternation regex,
    // stores the raw input as the replacement, and tags an image-rule seed id.
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.NumistaLookup.getCustomRules().some((r) => r.pattern === "morgan|peace")
        )
      )
      .toBe(true);
    expect(await page.evaluate(() => window.NumistaLookup.getCustomRules().length)).toBe(
      before + 1
    );
    const added = await page.evaluate(() =>
      window.NumistaLookup.getCustomRules().find((r) => r.pattern === "morgan|peace")
    );
    expect(added.replacement).toBe("morgan, peace");
    expect(String(added.seedImageId)).toMatch(/^custom-img-/);

    // Form auto-collapses and clears its inputs after a successful add.
    await expect(page.locator("#patternRuleFormContainer")).not.toBeVisible();
    await expect(toggleBtn).toContainText("New Rule");
    await toggleBtn.click();
    await expect(page.locator("#patternRulePattern")).toHaveValue("");
    await expect(page.locator("#patternRuleObverseName")).toHaveText("");

    // Rule survives a reload (persisted to localStorage).
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.NumistaLookup?.getCustomRules === "function");
    expect(
      await page.evaluate(() =>
        window.NumistaLookup.getCustomRules().some((r) => r.pattern === "morgan|peace")
      )
    ).toBe(true);
  });

  test("Image pattern rule is rejected when no image is selected", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const before = await page.evaluate(() => window.NumistaLookup.getCustomRules().length);

    await page.locator("#newPatternRuleBtn").click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();
    await page.locator("#patternRulePattern").fill("no-image-rule");
    await page.locator("#addPatternRuleBtn").click();

    // The image-requirement guard fires before addRule: no rule is created and
    // the form stays open (no auto-collapse).
    expect(await page.evaluate(() => window.NumistaLookup.getCustomRules().length)).toBe(before);
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();
  });
});

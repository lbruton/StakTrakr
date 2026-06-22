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

  // STRK-221: when the image processor returns no blob for a file the user
  // actually selected, the add must surface an error and abort — not silently
  // persist a rule with no cached image. (The no-processor branch falls back to
  // the raw File; the processor-present-but-failed branch must not drop it.)
  test("Image pattern rule is rejected when image processing yields no blob", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const before = await page.evaluate(() => window.NumistaLookup.getCustomRules().length);

    // Force the processor to fail (return null) for any file — mirrors a
    // transient decode/canvas failure, which processFile swallows as null.
    await page.waitForFunction(() => Boolean(window.imageProcessor));
    await page.evaluate(() => {
      window.imageProcessor.processFile = async () => null;
    });

    await page.locator("#newPatternRuleBtn").click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();
    await page.locator("#patternRulePattern").fill("processor-fail-rule");
    await page
      .locator("#patternRuleObverse")
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await expect(page.locator("#patternRuleObverseName")).toHaveText("test-obverse.png");

    await page.locator("#addPatternRuleBtn").click();

    // A user-visible error is surfaced via the custom #appDialogModal (not a
    // native dialog), and no rule is created (abort before addRule).
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await expect(page.locator("#appDialogModal")).toContainText("Failed to process image");
    expect(await page.evaluate(() => window.NumistaLookup.getCustomRules().length)).toBe(before);

    // Form stays open (no success-path reset/collapse).
    await page.locator("#appDialogOk").click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();
  });

  // STRK-221 (twin): the rule-EDIT path (js/settings.js) carried the same
  // silent-drop bug. A new upload whose processing yields no blob must error +
  // abort exactly like the create path — not quietly cache a null image.
  test("Editing a pattern rule is rejected when image processing yields no blob", async ({
    page,
  }) => {
    // Deterministic store: suppress the demo seed, one known rule, no images.
    await page.addInitScript(() => localStorage.setItem("seedImagesVer", "1"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.imageCache !== "undefined" &&
        Boolean(window.NumistaLookup) &&
        typeof window.showSettingsModal === "function"
    );
    await page.evaluate(async () => {
      await window.imageCache.init();
      await window.imageCache.clearAll();
      localStorage.setItem("numistaLookupRules", JSON.stringify([]));
      window.NumistaLookup.importRules([], false);
      window.NumistaLookup.addRule("edittwinrule", "edittwinrule", null, "custom-img-edittwin");
    });

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const rules = page.locator("#customPatternImageRules");
    await expect(rules).toContainText("edittwinrule");

    // Open the row's inline edit form.
    await rules.getByRole("button", { name: "Edit", exact: true }).click();
    const editForm = rules.locator(".pattern-rule-edit-form").first();
    await expect(editForm).toBeVisible();

    // Force the processor to fail, change the pattern too, upload a new obverse,
    // then save — both edits should be rejected together.
    await page.evaluate(() => {
      window.imageProcessor.processFile = async () => null;
    });
    await editForm.locator(".edit-pattern").fill("changedtwinrule");
    await editForm
      .locator(".edit-obverse")
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await editForm.locator(".edit-save-btn").click();

    // Same contract as the create path: a user-visible error via #appDialogModal.
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await expect(page.locator("#appDialogModal")).toContainText("Failed to process image");
    await page.locator("#appDialogOk").click();

    // The edit aborts wholesale: image resolution runs before the rule is
    // mutated, so the pattern change is NOT applied and the original survives.
    const patterns = await page.evaluate(() =>
      window.NumistaLookup.getCustomRules().map((r) => r.pattern)
    );
    expect(patterns).toContain("edittwinrule");
    expect(patterns).not.toContain("changedtwinrule");
  });

  // STRK-202: Settings ▸ Images surfaces pattern images whose rule no longer
  // exists (orphans) and lets the user reclaim the space. "Delete all" routes
  // through the custom showAppConfirm modal, not a native dialog.
  test("Orphaned pattern images are listed and can be cleared", async ({ page }) => {
    // Suppress the async demo seed (seed-images.js caches pattern rules+images on
    // boot); otherwise its writes can race our clearAll() and leave referenced
    // images behind. Re-boot with the seed gated off for a deterministic store.
    await page.addInitScript(() => localStorage.setItem("seedImagesVer", "1"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.imageCache !== "undefined" &&
        Boolean(window.NumistaLookup) &&
        typeof window.showSettingsModal === "function"
    );

    // Clean slate: no rules, two orphaned pattern-image records in IndexedDB.
    await page.evaluate(async () => {
      await window.imageCache.init();
      await window.imageCache.clearAll();
      localStorage.setItem("numistaLookupRules", JSON.stringify([]));
      window.NumistaLookup.importRules([], false);
      await window.imageCache.cachePatternImage(
        "orphan-strk202-a",
        new Blob(["a-obv"], { type: "image/png" }),
        new Blob(["a-rev"], { type: "image/png" })
      );
      await window.imageCache.cachePatternImage(
        "orphan-strk202-b",
        new Blob(["b-obv"], { type: "image/png" }),
        null
      );
    });

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText("orphan-strk202-a");
    await expect(container).toContainText("orphan-strk202-b");

    const deleteAll = container.getByRole("button", { name: "Delete all", exact: true });
    await expect(deleteAll).toBeVisible();
    await deleteAll.click();

    // Drive the custom confirm modal (#appDialogModal), not a native dialog.
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await page.locator("#appDialogOk").click();

    await expect(container).toContainText("No orphaned pattern images");
    const remaining = await page.evaluate(
      async () => (await window.imageCache.exportAllPatternImages()).length
    );
    expect(remaining).toBe(0);
  });
});

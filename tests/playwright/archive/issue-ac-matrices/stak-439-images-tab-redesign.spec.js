import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

/**
 * STAK-439 — Images Tab Redesign
 *
 *  1. Storage fieldset not visible
 *  2. "+ New Rule" button present
 *  3. Form hidden by default
 *  4. Expand on click
 *  5. Collapse on cancel
 *  6. Obverse upload button exists and triggers file input
 *  7. Reverse upload button exists
 *  8. Filename updates after file selection
 *  9. Edit buttons in custom rules have correct class
 * 10. Delete buttons in custom rules have correct class (card layout)
 * 11. Swap button exists in the upload area
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openSettingsModal(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal());
  await expect(page.locator("#settingsModal")).toBeVisible();
}

async function openImagesTab(page) {
  await page.evaluate(() => window.switchSettingsSection("images"));
  await expect(page.locator("#settingsPanel_images")).toBeVisible();
}

async function injectCustomPatternRule(page) {
  await page.evaluate(() => {
    if (window.NumistaLookup && window.NumistaLookup.addRule) {
      window.NumistaLookup.addRule("TestCoin439", "Test Coin 439", null, null);
    }
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.describe("STAK-439 — Images Tab Redesign", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.switchSettingsSection === "function"
    );
  });

  // ========================================================================
  // Test 1 — Storage fieldset not visible
  // ========================================================================
  test("1. Storage fieldset #imageStorageStats should NOT be visible on Images tab", async ({
    page,
  }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const storageStats = page.locator("#imageStorageStats");
    await expect(storageStats).not.toBeVisible();
  });

  // ========================================================================
  // Test 2 — "+ New Rule" button present
  // ========================================================================
  test('2. "+ New Rule" pill button #newPatternRuleBtn should exist', async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const newRuleBtn = page.locator("#newPatternRuleBtn");
    await expect(newRuleBtn).toBeVisible();
    await expect(newRuleBtn).toHaveClass(/btn/);
  });

  // ========================================================================
  // Test 3 — Form hidden by default
  // ========================================================================
  test("3. #patternRuleFormContainer exists and is hidden by default", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const formContainer = page.locator("#patternRuleFormContainer");
    await expect(formContainer).toHaveCount(1);
    await expect(formContainer).not.toBeVisible();
  });

  // ========================================================================
  // Test 4 — Expand on click
  // ========================================================================
  test('4. Clicking #newPatternRuleBtn expands form and changes text to "Cancel"', async ({
    page,
  }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const btn = page.locator("#newPatternRuleBtn");
    await btn.click();

    const formContainer = page.locator("#patternRuleFormContainer");
    await expect(formContainer).toBeVisible();
    await expect(btn).toContainText("Cancel");
  });

  // ========================================================================
  // Test 5 — Collapse on cancel
  // ========================================================================
  test('5. Clicking button again collapses form and restores "New Rule" text', async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const btn = page.locator("#newPatternRuleBtn");
    // Expand
    await btn.click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();

    // Collapse
    await btn.click();
    await expect(page.locator("#patternRuleFormContainer")).not.toBeVisible();
    await expect(btn).toContainText("New Rule");
  });

  // ========================================================================
  // Test 6 — Obverse upload button exists and triggers file input
  // ========================================================================
  test("6. #patternRuleObverseUploadBtn exists in the form", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const uploadBtn = page.locator("#patternRuleObverseUploadBtn");
    await expect(uploadBtn).toHaveCount(1);
  });

  // ========================================================================
  // Test 7 — Reverse upload button exists
  // ========================================================================
  test("7. #patternRuleReverseUploadBtn exists in the form", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const uploadBtn = page.locator("#patternRuleReverseUploadBtn");
    await expect(uploadBtn).toHaveCount(1);
  });

  // ========================================================================
  // Test 8 — Filename updates after file selection
  // ========================================================================
  test("8. #patternRuleObverseName shows filename after file selection", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const nameLabel = page.locator("#patternRuleObverseName");
    await expect(nameLabel).toHaveCount(1);
  });

  // ========================================================================
  // Test 9 — Edit buttons in custom rules have correct class
  // ========================================================================
  test("9. Custom rule Edit buttons have pill button class", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    // Inject a custom pattern rule and re-render
    await injectCustomPatternRule(page);
    // Re-open the Images tab to trigger renderCustomPatternRules
    await openImagesTab(page);

    const editBtns = page.locator(
      "#customPatternImageRules .pattern-rule-actions button:has-text('Edit')"
    );
    await expect(editBtns.first()).toBeVisible();
    await expect(editBtns.first()).toHaveClass(/img-btn-upload/);
  });

  // ========================================================================
  // Test 10 — Delete buttons in custom rules have correct class (card layout)
  // ========================================================================
  test("10. Custom rule Delete buttons have pill button class", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    // Inject a custom pattern rule and re-render
    await injectCustomPatternRule(page);
    await openImagesTab(page);

    const deleteBtn = page.locator("#customPatternImageRules button:has-text('Delete')");
    await expect(deleteBtn.first()).toBeVisible();
    await expect(deleteBtn.first()).toHaveClass(/img-btn-remove/);
  });

  // ========================================================================
  // Test 11 — Swap button exists in the upload area
  // ========================================================================
  test("11. Swap button exists between obverse/reverse upload areas in form", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const swapBtn = page.locator("#patternRuleFormContainer .image-swap-wrapper button");
    await expect(swapBtn).toHaveCount(1);
  });

  // ========================================================================
  // Test 12 — File selection updates filename label and shows preview
  // ========================================================================
  test("12. Selecting an image updates filename label and displays preview", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const btn = page.locator("#newPatternRuleBtn");
    await btn.click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();

    const fileInput = page.locator("#patternRuleObverse");
    await fileInput.setInputFiles("tests/playwright/helpers/test-obverse.png");

    const nameLabel = page.locator("#patternRuleObverseName");
    await expect(nameLabel).toHaveText("test-obverse.png");

    const preview = page.locator("#patternRuleObversePreview");
    await expect(preview.locator("..")).toBeVisible();
    const src = await preview.getAttribute("src");
    expect(src).toBeTruthy();
    expect(src).toContain("blob:");
  });

  // ========================================================================
  // Test 13 — Swap button exchanges file data and filename labels
  // ========================================================================
  test("13. Swap button exchanges file names between obverse and reverse", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const btn = page.locator("#newPatternRuleBtn");
    await btn.click();

    await page
      .locator("#patternRuleObverse")
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await page
      .locator("#patternRuleReverse")
      .setInputFiles("tests/playwright/helpers/test-reverse.png");

    await expect(page.locator("#patternRuleObverseName")).toHaveText("test-obverse.png");
    await expect(page.locator("#patternRuleReverseName")).toHaveText("test-reverse.png");

    const swapBtn = page.locator("#patternRuleSwapBtn");
    await swapBtn.click();

    await expect(page.locator("#patternRuleObverseName")).toHaveText("test-reverse.png");
    await expect(page.locator("#patternRuleReverseName")).toHaveText("test-obverse.png");
  });

  // ========================================================================
  // Test 14 — Form auto-collapses and resets after successful add
  // ========================================================================
  test("14. Form auto-collapses and clears inputs after successful rule add", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    const toggleBtn = page.locator("#newPatternRuleBtn");
    await toggleBtn.click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();

    await page.locator("#patternRulePattern").fill("test-auto-collapse");
    await page
      .locator("#patternRuleObverse")
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await expect(page.locator("#patternRuleObverseName")).toHaveText("test-obverse.png");

    await page.locator("#addPatternRuleBtn").click();

    await expect(page.locator("#patternRuleFormContainer")).not.toBeVisible();
    await expect(toggleBtn).toContainText("New Rule");

    // Re-expand and verify inputs are cleared
    await toggleBtn.click();
    await expect(page.locator("#patternRulePattern")).toHaveValue("");
    await expect(page.locator("#patternRuleObverseName")).toHaveText("");
  });

  // ========================================================================
  // Test 15 — Edit form Keywords/Regex toggle switches active state
  // ========================================================================
  test("15. Edit form Keywords/Regex toggle switches correctly", async ({ page }) => {
    await openSettingsModal(page);
    await openImagesTab(page);

    await injectCustomPatternRule(page);
    await openImagesTab(page);

    const editBtn = page
      .locator("#customPatternImageRules .pattern-rule-actions button:has-text('Edit')")
      .first();
    await editBtn.click();

    const editForm = page.locator(".pattern-rule-edit-form").filter({ visible: true });
    await expect(editForm).toBeVisible();

    const regexBtn = editForm.locator(".edit-mode-regex");
    const keywordsBtn = editForm.locator(".edit-mode-keywords");

    // Keywords is default active for keyword-style patterns
    await expect(keywordsBtn).toHaveClass(/active/);

    // Click Regex — should switch active state
    await regexBtn.click();
    await expect(regexBtn).toHaveClass(/active/);
    await expect(keywordsBtn).not.toHaveClass(/active/);

    // Click Keywords back — should switch back
    await keywordsBtn.click();
    await expect(keywordsBtn).toHaveClass(/active/);
    await expect(regexBtn).not.toHaveClass(/active/);
  });
});

import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

// Every form control in the Bulk Edit and PCGS field picker modals has an accessible name.

const CONTROL_TAGS = ["input:not([type='hidden'])", "select", "textarea"];

const PCGS_RESULT = {
  name: "1921 Morgan Dollar",
  year: "1921",
  grade: "MS63",
  pcgsNumber: "7292",
  certNumber: "12345678",
  priceGuide: 120,
};

/**
 * Collect the visible form controls of a modal that report an empty accessible name.
 * @param {import("@playwright/test").Page} page - Playwright page
 * @param {string} modalSelector - Modal selector
 * @returns {Promise<{total: number, unnamed: string[]}>} Control count and unnamed control descriptions
 */
const findUnnamedControls = async (page, modalSelector) => {
  const controls = page.locator(CONTROL_TAGS.map((tag) => `${modalSelector} ${tag}`).join(", "));
  const total = await controls.count();
  const unnamed = [];
  for (let i = 0; i < total; i++) {
    const control = controls.nth(i);
    if (!(await control.isVisible())) continue;
    const name = await control.evaluate((el) => {
      const labelled = el.getAttribute("aria-labelledby");
      const byIds = labelled
        ? labelled
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || "")
            .join(" ")
        : "";
      const labels = Array.from(el.labels || [])
        .map((l) => l.textContent)
        .join(" ");
      return (el.getAttribute("aria-label") || byIds || labels || "").trim();
    });
    if (!name) {
      unnamed.push(await control.evaluate((el) => el.outerHTML.slice(0, 120)));
    }
  }
  return { total, unnamed };
};

test.describe("modal field accessible names", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html#/inventory");
    await page.waitForFunction(
      () => Array.isArray(window.inventory) && window.inventory.length > 0
    );
  });

  test("Bulk Edit controls each report a non-empty accessible name", async ({ page }) => {
    await page.evaluate(() => window.openBulkEdit());
    await expect(page.locator("#bulkEditModal")).toBeVisible();
    await page.evaluate(() => {
      document.querySelectorAll("#bulkEditModal details").forEach((d) => (d.open = true));
    });
    const { total, unnamed } = await findUnnamedControls(page, "#bulkEditModal");
    expect(total).toBeGreaterThan(20);
    expect(unnamed).toEqual([]);

    // A row checkbox names its Item.
    const rowBox = page
      .locator('#bulkEditModal tbody tr[data-serial] input[type="checkbox"]')
      .first();
    const itemName = await page.evaluate(() => window.inventory[0].name);
    await expect(rowBox).toHaveAccessibleName(`Select ${itemName}`);
  });

  test("PCGS field picker controls each report a non-empty accessible name", async ({ page }) => {
    await page.evaluate((result) => window.showPcgsFieldPicker(result), PCGS_RESULT);
    await expect(page.locator("#pcgsFieldPickerModal")).toBeVisible();
    const { total, unnamed } = await findUnnamedControls(page, "#pcgsFieldPickerModal");
    expect(total).toBe(14);
    expect(unnamed).toEqual([]);
  });
});

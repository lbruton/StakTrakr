// Collections focus: one keyboard ring on every control, and focus that follows the
// hub to Album and back navigation.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { collectionItem, seedCollectionsPage } from "../helpers/collections-fixtures.js";
import { THEMES, applyTheme } from "../helpers/contrast.js";
import { disableTransitions, focusByKeyboard, expectFocusRing } from "../helpers/focus-ring.js";

const ALBUM_ID = "ase-type2";
const CARD = `[data-focus-key="open:${ALBUM_ID}"]`;

/**
 * Boots the app on the Collections hub with one linkable Item.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>}
 */
const openHub = async (page) => {
  await seedCollectionsPage(page, [
    collectionItem("focus-ase-2022", "2022 American Silver Eagle", "2022", 1),
  ]);
  await page.goto("/index.html#/collections");
  await expect(page.locator(CARD)).toBeVisible();
  await disableTransitions(page);
};

/**
 * Opens an Album from the hub card with the keyboard.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>}
 */
const openAlbumByKeyboard = async (page) => {
  await focusByKeyboard(page, page.locator(CARD));
  await page.keyboard.press("Enter");
  await expect(page.locator(".collections-album")).toBeVisible();
};

test.describe("core/collections — keyboard focus", () => {
  test("Back reveals the restored card on a hub taller than the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 300 });
    await openHub(page);
    await page.addStyleTag({ content: `${CARD} { margin-top: 900px; }` });
    await openAlbumByKeyboard(page);
    await focusByKeyboard(page, page.locator('[data-focus-key="album:back"]'));
    await page.keyboard.press("Enter");
    await expect(page.locator(CARD)).toBeFocused();
    await expect(page.locator(CARD)).toBeInViewport();
  });

  test("hub cards, chips and pills show the shared ring in every theme", async ({ page }) => {
    test.setTimeout(test.info().timeout * THEMES.length);
    await openHub(page);
    const controls = {
      "hub filter chip": '[data-focus-key="hubfilter:progress"]',
      "view toggle chip": '[data-focus-key="view:ledger"]',
      "Manage pill": '[data-focus-key="hub:manage"]',
      "hub card": CARD,
    };
    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await applyTheme(page, theme);
        for (const [what, selector] of Object.entries(controls)) {
          const control = page.locator(selector);
          await focusByKeyboard(page, control);
          await expectFocusRing(control, `${theme} ${what}`);
        }
      });
    }
  });

  test("Slot menu items and Album chips show the shared ring in every theme", async ({ page }) => {
    test.setTimeout(test.info().timeout * THEMES.length);
    await openHub(page);
    await openAlbumByKeyboard(page);
    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await applyTheme(page, theme);
        const chip = page.locator('[data-focus-key="Filter slots:owned"]');
        await focusByKeyboard(page, chip);
        await expectFocusRing(chip, `${theme} Album chip`);

        await page.locator('[data-focus-key="add:2022"]').click();
        const items = page.getByRole("menuitem");
        await expect(items.first()).toBeVisible();
        await page.keyboard.press("ArrowDown");
        const second = items.nth(1);
        await expect(second).toBeFocused();
        await expectFocusRing(second, `${theme} Slot menu item`);
        await page.keyboard.press("Escape");
        await expect(items).toHaveCount(0);
      });
    }
  });

  test("opening an Album focuses its heading and Back returns to the card", async ({ page }) => {
    await openHub(page);
    await openAlbumByKeyboard(page);
    const heading = page.locator(".collections-album-info h2");
    await expect(heading).toBeFocused();

    await focusByKeyboard(page, page.locator('[data-focus-key="album:back"]'));
    await page.keyboard.press("Enter");
    await expect(page.locator(CARD)).toBeFocused();
    await expect(page.locator(CARD)).toBeInViewport();

    await test.step("the browser Back button follows the same rule", async () => {
      await page.keyboard.press("Enter");
      await expect(heading).toBeFocused();
      await page.goBack();
      await expect(page.locator(CARD)).toBeFocused();
    });
  });
});

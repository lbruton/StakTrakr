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

/**
 * Presses the Album's Back button with the keyboard.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>}
 */
const backByKeyboard = async (page) => {
  await focusByKeyboard(page, page.locator('[data-focus-key="album:back"]'));
  await page.keyboard.press("Enter");
};

/**
 * Runs one step per theme, with the per-test timeout scaled to the theme count.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {(theme: string) => Promise<void>} check - Assertions for the active theme.
 * @returns {Promise<void>}
 */
const inEveryTheme = async (page, check) => {
  test.setTimeout(test.info().timeout * THEMES.length);
  for (const theme of THEMES) {
    await test.step(theme, async () => {
      await applyTheme(page, theme);
      await check(theme);
    });
  }
};

/**
 * Focuses a control by keyboard and asserts the shared ring on it.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {import('@playwright/test').Locator} control - Control to check.
 * @param {string} what - Name for the failure message.
 * @returns {Promise<void>}
 */
const expectRingOnFocus = async (page, control, what) => {
  await focusByKeyboard(page, control);
  await expectFocusRing(control, what);
};

/**
 * Asserts the card is focused and on screen.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>}
 */
const expectCardRestored = async (page) => {
  await expect(page.locator(CARD)).toBeFocused();
  await expect(page.locator(CARD)).toBeInViewport();
};

test.describe("core/collections — keyboard focus", () => {
  test("hub cards, chips and pills show the shared ring in every theme", async ({ page }) => {
    await openHub(page);
    const controls = {
      "hub filter chip": '[data-focus-key="hubfilter:progress"]',
      "view toggle chip": '[data-focus-key="view:ledger"]',
      "Manage pill": '[data-focus-key="hub:manage"]',
      "hub card": CARD,
    };
    await inEveryTheme(page, async (theme) => {
      for (const [what, selector] of Object.entries(controls)) {
        await expectRingOnFocus(page, page.locator(selector), `${theme} ${what}`);
      }
    });
  });

  test("Slot menu items and Album chips show the shared ring in every theme", async ({ page }) => {
    await openHub(page);
    await openAlbumByKeyboard(page);
    const items = page.getByRole("menuitem");
    await inEveryTheme(page, async (theme) => {
      const chip = page.locator('[data-focus-key="Filter slots:owned"]');
      await expectRingOnFocus(page, chip, `${theme} Album chip`);
      await page.locator('[data-focus-key="add:2022"]').click();
      await expect(items.first()).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await expect(items.nth(1)).toBeFocused();
      await expectFocusRing(items.nth(1), `${theme} Slot menu item`);
      await page.keyboard.press("Escape");
      await expect(items).toHaveCount(0);
    });
  });

  test("opening an Album focuses its heading and Back returns to the card", async ({ page }) => {
    await openHub(page);
    await openAlbumByKeyboard(page);
    const heading = page.locator(".collections-album-info h2");
    await expect(heading).toBeFocused();
    await backByKeyboard(page);
    await expectCardRestored(page);

    await test.step("the browser Back button follows the same rule", async () => {
      await page.keyboard.press("Enter");
      await expect(heading).toBeFocused();
      await page.goBack();
      await expectCardRestored(page);
    });
  });

  test("Back reveals the restored card on a hub taller than the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 300 });
    await openHub(page);
    await page.addStyleTag({ content: `${CARD} { margin-top: 900px; }` });
    await openAlbumByKeyboard(page);
    await backByKeyboard(page);
    await expectCardRestored(page);
  });

  test("an Album re-render from a filter or sort change keeps focus on the control used", async ({
    page,
  }) => {
    await openHub(page);
    await openAlbumByKeyboard(page);
    const controls = [
      '[data-focus-key="Filter slots:owned"]',
      '[data-focus-key="Sort slots:newest"]',
    ];
    for (const selector of controls) {
      const control = page.locator(selector);
      await focusByKeyboard(page, control);
      await page.keyboard.press("Enter");
      await expect(control).toHaveAttribute("aria-pressed", "true");
      await expect(control).toBeFocused();
    }
  });

  test("the Album actions row keeps the Clone & customize focus key", async ({ page }) => {
    await openHub(page);
    await openAlbumByKeyboard(page);
    const clone = page.locator('.collections-album-actions [data-focus-key="album:clone"]');
    await expect(clone).toBeVisible();
    await expectRingOnFocus(page, clone, "Clone & customize");
  });
});

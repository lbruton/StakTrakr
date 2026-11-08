// Remove Item: toast with Undo, Activity Log link, and the single Activity Log name.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { collectionItem, seedCollectionsPage } from "../helpers/collections-fixtures.js";

const NAME = "2022 American Silver Eagle";
const SEED = [
  collectionItem("rm-ase-2022", NAME, "2022", 1),
  collectionItem("rm-ase-2024", "2024 American Silver Eagle BU", "2024", 2),
];

/**
 * Delete the Item named NAME through the Remove Item modal.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>}
 */
const deleteFirstItem = async (page) => {
  await page.evaluate(() => window.openRemoveItemModal(0, false));
  await expect(page.locator("#removeItemModal")).toBeVisible();
  await page.locator("#removeItemDeleteBtn").click();
  await expect(page.locator("#removeItemModal")).toBeHidden();
};

const inventoryHas = (page, uuid) =>
  page.evaluate((id) => window.inventory.some((entry) => entry.uuid === id), uuid);

/**
 * Link the 2022 Item to its slot, plus the 2024 Item as a spare when asked.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {boolean} withSpare - Whether to add the spare.
 * @returns {Promise<void>}
 */
const linkSlot = (page, withSpare) =>
  page.evaluate((spare) => {
    const store = window.collectionsStore;
    store.link("ase-type2", "2022", "rm-ase-2022");
    if (spare) store.link("ase-type2", "2022", "rm-ase-2024", { asSpare: true });
  }, withSpare);

/**
 * Read the 2022 slot's primary and spares.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<{primary: string|null, spares: string[]}>} Slot contents.
 */
const readSlot = (page) =>
  page.evaluate(() => {
    const link = window.collectionsStore.getState().collections["ase-type2"].slots["2022"];
    return { primary: link ? link.primary : null, spares: link ? link.spares : [] };
  });

/**
 * Delete the first Item, press Undo on the toast, and wait for the Item to return.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>}
 */
const deleteThenUndo = async (page) => {
  await deleteFirstItem(page);
  await page
    .locator(".cloud-toast", { hasText: `Removed ${NAME}.` })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect.poll(() => inventoryHas(page, "rm-ase-2022")).toBe(true);
};

/**
 * Toggle the newest Activity Log entry (Redo after an Undo, Undo after a Redo).
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {boolean} expectPresent - Whether the 2022 Item should be in inventory afterwards.
 * @returns {Promise<void>}
 */
const toggleLatest = async (page, expectPresent) => {
  await page.evaluate(() => window.toggleChange(window.changeLog.length - 1));
  await expect.poll(() => inventoryHas(page, "rm-ase-2022")).toBe(expectPresent);
};

test.describe("core/remove-item-undo", () => {
  test.beforeEach(async ({ page }) => {
    await seedCollectionsPage(page, SEED);
  });

  test("removing an Item shows a toast with Undo, and Undo restores the Item and its Collection link", async ({
    page,
  }) => {
    await linkSlot(page, false);
    await deleteFirstItem(page);
    const toast = page.locator(".cloud-toast", { hasText: `Removed ${NAME}.` });
    await expect(toast).toBeVisible();
    expect(await inventoryHas(page, "rm-ase-2022")).toBe(false);

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => inventoryHas(page, "rm-ase-2022")).toBe(true);
    await expect(page.locator("#inventoryTable tbody")).toContainText(NAME);
    expect((await readSlot(page)).primary).toBe("rm-ase-2022");
  });

  test("Undo puts a deleted primary back ahead of the spare the delete promoted", async ({
    page,
  }) => {
    await linkSlot(page, true);
    await deleteThenUndo(page);
    expect(await readSlot(page)).toEqual({ primary: "rm-ase-2022", spares: ["rm-ase-2024"] });
  });

  test("Redo of a restored removal prunes the Collection links again", async ({ page }) => {
    await linkSlot(page, true);
    await deleteThenUndo(page);
    await toggleLatest(page, false);
    expect(await readSlot(page)).toEqual({ primary: "rm-ase-2024", spares: [] });
  });

  test("Redo captures the current links, so a second Undo does not reverse an unlink", async ({
    page,
  }) => {
    await linkSlot(page, false);
    await deleteThenUndo(page);
    await page.evaluate(() => window.collectionsStore.unlink("ase-type2", "2022", "rm-ase-2022"));
    await toggleLatest(page, false);
    await toggleLatest(page, true);
    expect((await readSlot(page)).primary).toBeNull();
  });

  test("a toast given an error level keeps the default delay", async ({ page }) => {
    await page.evaluate(() => window.showToast("Delete failed.", "error"));
    const toast = page.locator(".cloud-toast", { hasText: "Delete failed." });
    await expect(toast).toBeVisible();
    await page.waitForTimeout(500);
    await expect(toast).not.toHaveClass(/fade-out/);
  });

  test("the Activity Log link lists the removal with its Undo action", async ({ page }) => {
    await deleteFirstItem(page);
    await page.evaluate(() => window.openRemoveItemModal(0, false));
    await page.locator("#removeItemOpenLog").click();

    const modal = page.locator("#changeLogModal");
    await expect(modal).toBeVisible();
    const row = modal.locator("tbody tr", { hasText: NAME });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("button", { name: "Undo" })).toBeVisible();
  });

  test("the Activity Log opened right after a delete lists the removal", async ({ page }) => {
    await deleteFirstItem(page);
    await page.evaluate(() => window.openModalById("changeLogModal"));
    await expect(
      page.locator("#changeLogModal tbody tr", { hasText: NAME }).getByRole("button", {
        name: "Undo",
      })
    ).toBeVisible();
  });

  test("the log uses one name in the modal, the link, the confirm and the FAQ", async ({
    page,
  }) => {
    await page.evaluate(() => window.openModalById("changeLogModal"));
    await expect(page.locator("#changeLogModalTitle")).toHaveText("Activity Log");
    const html = await page.evaluate(() => document.body.innerText);
    expect(html).not.toMatch(/change ?log/i);
    const markup = await page.evaluate(() => document.documentElement.outerHTML);
    expect(markup).not.toMatch(/>[^<]*change log[^<]*</i);
    await page.evaluate(() => window.openRemoveItemModal(0, false));
    await expect(page.locator("#removeItemOpenLog")).toHaveText("Activity Log");
    const button = page.locator("#changeLogBtn");
    await expect(button).toHaveAttribute("title", "Activity Log");
    await expect(button).toHaveAttribute("aria-label", "Activity Log");

    const confirmText = await page.evaluate(async () => {
      let seen = "";
      const original = window.showAppConfirm;
      window.showAppConfirm = (message, title, options) => {
        seen = [message, title, options && options.confirmLabel].join("|");
        return Promise.resolve(false);
      };
      await window.clearChangeLog();
      window.showAppConfirm = original;
      return seen;
    });
    expect(confirmText).toContain("Activity Log");
    expect(confirmText).not.toMatch(/change ?log/i);
  });
});

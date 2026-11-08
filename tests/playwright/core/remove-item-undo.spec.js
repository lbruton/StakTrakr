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

test.describe("core/remove-item-undo", () => {
  test.beforeEach(async ({ page }) => {
    await seedCollectionsPage(page, SEED);
  });

  test("removing an Item shows a toast with Undo, and Undo restores the Item and its Collection link", async ({
    page,
  }) => {
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2022", "rm-ase-2022"));
    await deleteFirstItem(page);

    const toast = page.locator(".cloud-toast", { hasText: `Removed ${NAME}.` });
    await expect(toast).toBeVisible();
    expect(await inventoryHas(page, "rm-ase-2022")).toBe(false);

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => inventoryHas(page, "rm-ase-2022")).toBe(true);
    await expect(page.locator("#inventoryTable tbody")).toContainText(NAME);
    const primary = await page.evaluate(
      () => window.collectionsStore.getState().collections["ase-type2"].slots["2022"].primary
    );
    expect(primary).toBe("rm-ase-2022");
  });

  test("Undo puts a deleted primary back ahead of the spare the delete promoted", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2022", "rm-ase-2022");
      window.collectionsStore.link("ase-type2", "2022", "rm-ase-2024", { asSpare: true });
    });
    await deleteFirstItem(page);
    const toast = page.locator(".cloud-toast", { hasText: `Removed ${NAME}.` });
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => inventoryHas(page, "rm-ase-2022")).toBe(true);
    const slot = await page.evaluate(() => {
      const link = window.collectionsStore.getState().collections["ase-type2"].slots["2022"];
      return { primary: link.primary, spares: link.spares };
    });
    expect(slot).toEqual({ primary: "rm-ase-2022", spares: ["rm-ase-2024"] });
  });

  test("Redo of a restored removal prunes the Collection links again", async ({ page }) => {
    await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2022", "rm-ase-2022");
      window.collectionsStore.link("ase-type2", "2022", "rm-ase-2024", { asSpare: true });
    });
    await deleteFirstItem(page);
    await page
      .locator(".cloud-toast", { hasText: `Removed ${NAME}.` })
      .getByRole("button", { name: "Undo" })
      .click();
    await expect.poll(() => inventoryHas(page, "rm-ase-2022")).toBe(true);

    await page.evaluate(() => window.toggleChange(window.changeLog.length - 1));
    await expect.poll(() => inventoryHas(page, "rm-ase-2022")).toBe(false);
    const slot = await page.evaluate(() => {
      const link = window.collectionsStore.getState().collections["ase-type2"].slots["2022"];
      return { primary: link.primary, spares: link.spares };
    });
    expect(slot).toEqual({ primary: "rm-ase-2024", spares: [] });
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

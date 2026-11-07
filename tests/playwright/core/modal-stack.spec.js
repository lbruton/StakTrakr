import { test, expect } from "../helpers/mocks/extended-test.js";

// The open-modal stack: Escape closes only the top modal, focus moves into a modal on open,
// stays inside on Tab and returns to the opener on close, and the body scroll lock holds
// until the last modal closes.

const OPENER_ID = "modalStackTestOpener";

/**
 * Boot on the Inventory tab with the sample inventory, a two-line note on the first Item,
 * and a plain button that stands in for the control that opens each modal.
 * @param {import("@playwright/test").Page} page - Playwright page
 * @returns {Promise<void>}
 */
const bootWithOpener = async (page) => {
  await page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  });
  await page.goto("/index.html#/inventory");
  await page.waitForFunction(() => Array.isArray(window.inventory) && window.inventory.length > 0);
  await page.evaluate((id) => {
    window.inventory[0].notes = "First line\nSecond line";
    const opener = document.createElement("button");
    opener.id = id;
    opener.type = "button";
    opener.textContent = "Open";
    opener.style.cssText = "position:fixed;top:0;left:0;z-index:1";
    document.body.appendChild(opener);
  }, OPENER_ID);
};

/**
 * Focus the stand-in opener, then run an opener expression in the page.
 * @param {import("@playwright/test").Page} page - Playwright page
 * @param {string} expression - Page expression that opens a modal
 * @returns {Promise<void>}
 */
const openFrom = async (page, expression) => {
  await page.evaluate(
    ({ id, expr }) => {
      document.getElementById(id).focus();
      void new Function(`return (${expr});`)();
    },
    { id: OPENER_ID, expr: expression }
  );
};

/**
 * Report whether focus sits inside the element that matches a selector.
 * @param {import("@playwright/test").Page} page - Playwright page
 * @param {string} selector - Modal selector
 * @returns {Promise<boolean>}
 */
const focusInside = (page, selector) =>
  page.evaluate((sel) => {
    const modal = document.querySelector(sel);
    return Boolean(
      modal && modal.contains(document.activeElement) && document.activeElement !== modal
    );
  }, selector);

const activeId = (page) =>
  page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

const bodyOverflow = (page) => page.evaluate(() => document.body.style.overflow);

const MODALS = [
  { name: "Settings", open: "showSettingsModal()", modal: "#settingsModal" },
  { name: "Edit Item", open: "editItem(0)", modal: "#itemModal" },
  { name: "Notes", open: "showNotes(0)", modal: "#notesModal" },
  { name: "Notes view", open: "showNotesView(0)", modal: "#notesViewModal" },
  { name: "Remove Item", open: "openRemoveItemModal(0)", modal: "#removeItemModal" },
  { name: "Bulk Edit", open: "openBulkEdit()", modal: "#bulkEditModal" },
  {
    name: "Item price history",
    open: "openItemPriceHistoryModal(inventory[0].uuid, inventory[0].name)",
    modal: "#itemPriceHistoryModal",
  },
  { name: "Metal details", open: 'showDetailsModal("Silver")', modal: "#detailsModal" },
  { name: "Item view", open: "showViewModal(0)", modal: "#viewItemModal" },
  { name: "Goldback history", open: "showGoldbackHistoryModal()", modal: "#goldbackHistoryModal" },
  { name: "Spot API history", open: "showApiHistoryModal()", modal: "#apiHistoryModal" },
  { name: "Catalog API history", open: "showCatalogHistoryModal()", modal: "#catalogHistoryModal" },
  { name: "Provider info", open: 'showProviderInfo("STAKTRAKR")', modal: "#apiInfoModal" },
  { name: "Debug log", open: "showDebugModal()", modal: "#debugModal" },
  { name: "API health", open: "showApiHealthModal()", modal: "#apiHealthModal" },
  { name: "Ratios", open: 'openRatiosPanelModal("au-ag")', modal: "#ratiosPanelModal" },
  { name: "Vault", open: 'openVaultModal("export")', modal: "#vaultModal" },
  { name: "App confirm", open: 'showAppConfirm("Close this?")', modal: "#appDialogModal" },
];

test.describe("modal stack", () => {
  test("each modal takes focus, keeps Tab inside and returns focus to its opener on Escape", async ({
    page,
  }) => {
    test.setTimeout(test.info().timeout * 3);
    await bootWithOpener(page);

    for (const entry of MODALS) {
      await test.step(entry.name, async () => {
        await openFrom(page, entry.open);
        const modal = page.locator(entry.modal);
        await expect(modal).toBeVisible();
        await expect
          .poll(() => focusInside(page, entry.modal), "focus moves into the modal")
          .toBe(true);

        for (let i = 0; i < 6; i += 1) {
          await page.keyboard.press("Tab");
          expect(await focusInside(page, entry.modal), `Tab ${i + 1} stays inside`).toBe(true);
        }

        await page.keyboard.press("Escape");
        await expect(modal).toBeHidden();
        await expect.poll(() => activeId(page), "focus returns to the opener").toBe(OPENER_ID);
        expect(await bodyOverflow(page), "the scroll lock clears with the last modal").toBe("");
      });
    }
  });

  test("Escape on a modal stacked over Settings closes only the top modal", async ({ page }) => {
    await bootWithOpener(page);
    await openFrom(page, "showSettingsModal()");
    await expect(page.locator("#settingsModal")).toBeVisible();

    await page.locator("#settingsModal .settings-nav-item").first().focus();
    const settingsControl = await activeId(page);
    await page.evaluate(() => openVaultModal("export"));
    await expect(page.locator("#vaultModal")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator("#vaultModal")).toBeHidden();
    await expect(page.locator("#settingsModal")).toBeVisible();
    await expect.poll(() => focusInside(page, "#settingsModal")).toBe(true);
    expect(await activeId(page)).toBe(settingsControl);
    expect(await bodyOverflow(page), "Settings is still open").toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(page.locator("#settingsModal")).toBeHidden();
    await expect.poll(() => activeId(page)).toBe(OPENER_ID);
    expect(await bodyOverflow(page)).toBe("");
  });

  test("Escape on Price History over Edit Item leaves the Edit form open", async ({ page }) => {
    await bootWithOpener(page);
    await openFrom(page, "editItem(0)");
    await expect(page.locator("#itemModal")).toBeVisible();
    await page.evaluate(() => openItemPriceHistoryModal(inventory[0].uuid, inventory[0].name));
    await expect(page.locator("#itemPriceHistoryModal")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator("#itemPriceHistoryModal")).toBeHidden();
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect.poll(() => focusInside(page, "#itemModal")).toBe(true);
  });

  test("Escape on the sync review cancels the pending review", async ({ page }) => {
    await bootWithOpener(page);
    await page.evaluate(() => {
      window.__diffResult = null;
      window.DiffModal.show({
        diff: { added: [], modified: [], deleted: [], unchanged: [] },
        onApply: () => {
          window.__diffResult = "applied";
        },
        onCancel: () => {
          window.__diffResult = "cancelled";
        },
      });
    });
    await expect(page.locator("#diffReviewModal")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator("#diffReviewModal")).toBeHidden();
    expect(await page.evaluate(() => window.__diffResult)).toBe("cancelled");
  });

  test("the scroll lock holds while a parent modal is open, and close buttons return focus", async ({
    page,
  }) => {
    await bootWithOpener(page);
    await openFrom(page, "showSettingsModal()");
    await expect(page.locator("#settingsModal")).toBeVisible();
    await page.evaluate(() => showDebugModal());
    await expect(page.locator("#debugModal")).toBeVisible();

    await page.locator("#debugModal .modal-close").first().click();
    await expect(page.locator("#debugModal")).toBeHidden();
    expect(await bodyOverflow(page), "Settings is still open").toBe("hidden");

    await page.locator("#settingsCloseBtn").click();
    await expect(page.locator("#settingsModal")).toBeHidden();
    expect(await bodyOverflow(page)).toBe("");
    await expect.poll(() => activeId(page)).toBe(OPENER_ID);
  });
});

import { test, expect } from "../helpers/mocks/extended-test.js";
import { suppressWhatsNewPopup } from "../helpers/seed.js";

// The open-modal stack: Escape closes only the top modal, focus moves into a modal on open,
// stays inside on Tab and returns to the opener on close, and the body scroll lock holds
// until the last modal closes. Every modal shares one shell: header, title, close and footer.

const OPENER_ID = "modalStackTestOpener";

/**
 * Boot on the Inventory tab with the sample inventory, a two-line note on the first Item,
 * and a plain button that stands in for the control that opens each modal.
 * @param {import("@playwright/test").Page} page - Playwright page
 * @returns {Promise<void>}
 */
const bootWithOpener = async (page) => {
  const seed = structuredClone((await import("../../fixtures/seed-inventory.js")).default);
  seed.metalInventory[0].notes = "First line\nSecond line";
  await page.addInitScript((data) => {
    Object.entries(data).forEach(([key, value]) => {
      localStorage.setItem(key, JSON.stringify(value));
    });
  }, seed);
  await suppressWhatsNewPopup(page);
  await page.goto("/index.html#/inventory");
  await page.waitForFunction(() => Array.isArray(window.inventory) && window.inventory.length > 0);
  await page.evaluate((id) => {
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

/**
 * Focus the first or last visible control in a modal and return its index in that list.
 * @param {import("@playwright/test").Page} page - Playwright page
 * @param {string} selector - Modal selector
 * @param {"first"|"last"} edge - Which end of the Tab order to focus
 * @returns {Promise<number>} Index of the focused control, or -1 when the modal holds none
 */
const focusEdge = (page, selector, edge) =>
  page.evaluate(
    ({ sel, which }) => {
      const controls = [
        ...document
          .querySelector(sel)
          .querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ),
      ].filter((el) => el.getClientRects().length > 0);
      if (controls.length === 0) return -1;
      const index = which === "first" ? 0 : controls.length - 1;
      controls[index].focus();
      return index;
    },
    { sel: selector, which: edge }
  );

/**
 * Report whether focus sits on the first or last visible control in a modal.
 * @param {import("@playwright/test").Page} page - Playwright page
 * @param {string} selector - Modal selector
 * @param {"first"|"last"} edge - Which end of the Tab order to check
 * @returns {Promise<boolean>}
 */
const focusOnEdge = (page, selector, edge) =>
  page.evaluate(
    ({ sel, which }) => {
      const controls = [
        ...document
          .querySelector(sel)
          .querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ),
      ].filter((el) => el.getClientRects().length > 0);
      const target = which === "first" ? controls[0] : controls[controls.length - 1];
      return document.activeElement === target;
    },
    { sel: selector, which: edge }
  );

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
        expect(await bodyOverflow(page), "the page behind is locked").toBe("hidden");

        for (let i = 0; i < 6; i += 1) {
          await page.keyboard.press("Tab");
          expect(await focusInside(page, entry.modal), `Tab ${i + 1} stays inside`).toBe(true);
        }

        if ((await focusEdge(page, entry.modal, "last")) !== -1) {
          await page.keyboard.press("Tab");
          expect(await focusOnEdge(page, entry.modal, "first"), "Tab wraps to the first").toBe(
            true
          );
          await page.keyboard.press("Shift+Tab");
          expect(await focusOnEdge(page, entry.modal, "last"), "Shift+Tab wraps to the last").toBe(
            true
          );
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

    await page.locator("#debugModal .modal-shell-close").first().click();
    await expect(page.locator("#debugModal")).toBeHidden();
    expect(await bodyOverflow(page), "Settings is still open").toBe("hidden");

    await page.locator("#settingsCloseBtn").click();
    await expect(page.locator("#settingsModal")).toBeHidden();
    expect(await bodyOverflow(page)).toBe("");
    await expect.poll(() => activeId(page)).toBe(OPENER_ID);
  });

  test("every modal uses the one shell: opaque, serif 400 title, 44px close, phone sheet", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await page.goto("/index.html");
    await page.addStyleTag({
      content:
        "*, *::before, *::after { transition: none !important; animation: none !important; }",
    });
    await page.evaluate(() => {
      showAppAlert("Shell check", "Notice");
      window.collectionsPicker.openBuilder();
    });
    await expect(page.locator("#appDialogModal")).toBeVisible();
    await expect(page.locator("#collectionsBuilderModal")).toBeVisible();

    const readShellBreaks = (theme) =>
      page.evaluate((name) => {
        document.documentElement.setAttribute("data-theme", name);
        const breaks = [];
        document.querySelectorAll(".modal[id]").forEach((modal) => {
          const shown = modal.style.display;
          modal.style.display = "flex";
          const shell = modal.querySelector(":scope > .modal-shell");
          const close = modal.querySelector(".modal-shell-close");
          const title = modal.querySelector(".modal-shell-header .modal-shell-title");
          const layers = [modal, shell].filter(Boolean);
          if (!shell || !/\bmodal-shell--(sm|md|lg)\b/.test(shell.className))
            breaks.push(`${modal.id}: no sized shell`);
          if (layers.some((el) => getComputedStyle(el).backdropFilter !== "none"))
            breaks.push(`${modal.id}: backdrop-filter`);
          if (
            shell &&
            !/^(rgb|oklch|color)\((?!.*\/ 0?\.)/.test(getComputedStyle(shell).backgroundColor)
          )
            breaks.push(
              `${modal.id}: translucent surface ${getComputedStyle(shell).backgroundColor}`
            );
          if (close) {
            const box = close.getBoundingClientRect();
            if (
              Math.round(box.width) !== 44 ||
              Math.round(box.height) !== 44 ||
              !close.querySelector("svg")
            )
              breaks.push(`${modal.id}: close ${box.width}x${box.height}`);
          }
          if (title) {
            const cs = getComputedStyle(title);
            if (cs.fontWeight !== "400" || !cs.fontFamily.includes("Instrument Serif"))
              breaks.push(`${modal.id}: title ${cs.fontWeight} ${cs.fontFamily}`);
          }
          modal.style.display = shown;
        });
        return breaks;
      }, theme);

    for (const theme of ["light", "dark", "slate", "sepia"]) {
      expect(await readShellBreaks(theme), theme).toEqual([]);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const shell = document.querySelector("#appDialogModal .modal-shell");
          const box = shell.getBoundingClientRect();
          return { left: box.left, right: Math.round(box.right), bottom: Math.round(box.bottom) };
        })
      )
      .toEqual({ left: 0, right: 390, bottom: 844 });
  });
});

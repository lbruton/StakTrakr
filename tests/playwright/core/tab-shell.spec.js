import { test, expect } from "../helpers/mocks/extended-test.js";
import { suppressWhatsNewPopup } from "../helpers/seed.js";

/**
 * STRK-282 — v2 tab shell.
 *
 * The shell wraps the existing page sections in four visibility panels
 * (Dashboard / Inventory / Market / Collections) driven by a header nav on
 * desktop and a fixed bottom bar on mobile. Section ids and module behavior
 * inside the panels are unchanged, so the risk this file guards is not the
 * switching itself but what wrapping does to code that reaches ACROSS the
 * sections — anything mounted relative to a section is now inside a panel that
 * may be display:none.
 */

/**
 * Boot the app on its default tab and wait until the shell is wired.
 *
 * Deliberately navigates to a bare /index.html with no route hash: these cases
 * assert the Dashboard-default boot, so a deep link would defeat the point.
 *
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
const gotoApp = async (page) => {
  await suppressWhatsNewPopup(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  // Never sleep — the shell wires its handlers alongside the app listeners.
  await page.waitForFunction(() => window.appListenersReady === true);
};

test.describe("core/STRK-282 tab shell", () => {
  test("boots on Dashboard with the other three panels hidden", async ({ page }) => {
    await gotoApp(page);

    await expect(page.locator("#tabViewDashboard")).toBeVisible();
    for (const id of ["#tabViewInventory", "#tabViewMarket", "#tabViewCollections"]) {
      await expect(page.locator(id)).toBeHidden();
    }
    await expect(page.locator("#tabBtnDashboard")).toHaveAttribute("aria-selected", "true");
  });

  test("arrow keys, Home and End move through the tablist (STRK-282)", async ({ page }) => {
    await gotoApp(page);

    // Declaring role="tablist"/"tab" promises arrow-key movement to assistive
    // tech; click-only handling leaves that promise unkept.
    await page.locator("#tabBtnDashboard").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tabViewInventory")).toBeVisible();
    await expect(page.locator("#tabBtnInventory")).toBeFocused();

    await page.keyboard.press("End");
    await expect(page.locator("#tabViewCollections")).toBeVisible();

    await page.keyboard.press("Home");
    await expect(page.locator("#tabViewDashboard")).toBeVisible();

    // Roving tabindex: only the selected tab sits in the page tab order.
    const tabIndexes = await page.evaluate(() =>
      [...document.querySelectorAll("#appTabNav [role='tab']")].map((b) => b.tabIndex)
    );
    expect(tabIndexes.filter((i) => i === 0)).toHaveLength(1);
  });

  test("a hashless URL from Back restores the default tab (STRK-282)", async ({ page }) => {
    await gotoApp(page);

    await page.locator("#tabBtnInventory").click();
    await expect(page).toHaveURL(/#\/inventory$/);

    // Back returns to the original hashless URL. Ignoring an empty hash left
    // the address bar and the visible panel disagreeing.
    await page.goBack();
    await expect(page.locator("#tabViewDashboard")).toBeVisible();
    await expect(page.locator("#tabViewInventory")).toBeHidden();
  });

  test("the inventory portal is sized after its panel is revealed (STRK-282)", async ({ page }) => {
    // REGRESSION GUARD. updatePortalHeight sizes the table portal from
    // getBoundingClientRect on the header and first row, which report 0 inside
    // a display:none panel. init.js renders the table at boot while Dashboard
    // is active, so without a recompute on reveal a user whose row count
    // exceeds itemsPerPage opens Inventory to a portal collapsed to ~1px.
    //
    // A finite itemsPerPage is REQUIRED to reach the bug at all: the default is
    // "all" (Infinity), and pagination.js returns early on
    // `totalRows <= itemsPerPage` before it ever measures anything. Seeded via
    // localStorage rather than assigned at runtime, because the settings path
    // reloads the page.
    await page.addInitScript(() => localStorage.setItem("settingsItemsPerPage", "3"));
    await gotoApp(page);

    const measurePortal = () =>
      page.evaluate(() => {
        const el = document.querySelector(".portal-scroll");
        return el ? Math.round(el.getBoundingClientRect().height) : null;
      });

    // Reached by switching — the table was rendered while this panel was hidden.
    await page.locator("#tabBtnInventory").click();
    await expect(page.locator("#tabViewInventory")).toBeVisible();
    await expect(page.locator("#tabViewInventory")).toBeVisible();
    const afterSwitch = await measurePortal();

    // Control: reached by deep link, so the table was rendered while visible.
    await suppressWhatsNewPopup(page);
    await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.appListenersReady === true);
    await expect(page.locator("#tabViewInventory")).toBeVisible();
    const deepLinked = await measurePortal();

    // Both routes must size the portal identically. Without the recompute the
    // switched-to case measured zero heights and collapsed to roughly 1px.
    expect(afterSwitch).not.toBeNull();
    expect(afterSwitch).toBeGreaterThan(20);
    expect(Math.abs(afterSwitch - deepLinked)).toBeLessThanOrEqual(2);
  });

  test("clicking a tab swaps the visible panel and moves aria-selected", async ({ page }) => {
    await gotoApp(page);

    await page.locator("#tabBtnInventory").click();
    await expect(page.locator("#tabViewInventory")).toBeVisible();
    await expect(page.locator("#tabViewDashboard")).toBeHidden();
    await expect(page.locator("#tabBtnInventory")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#tabBtnDashboard")).toHaveAttribute("aria-selected", "false");

    await page.locator("#tabBtnMarket").click();
    await expect(page.locator("#tabViewMarket")).toBeVisible();
    await expect(page.locator("#tabViewInventory")).toBeHidden();
  });

  test("every wrapped section lands in its intended panel", async ({ page }) => {
    await gotoApp(page);

    // Dashboard is already active on boot.
    await expect(page.locator("#spotPricesSection")).toBeVisible();
    await expect(page.locator("#totalsSectionEl")).toBeVisible();
    // ...and the sections owned by other tabs are not.
    await expect(page.locator("#tableSectionEl")).toBeHidden();

    await page.locator("#tabBtnInventory").click();
    await expect(page.locator("#searchSectionEl")).toBeVisible();
    await expect(page.locator("#tableSectionEl")).toBeVisible();

    await page.locator("#tabBtnMarket").click();
    await expect(page.locator("#vendorPricesSectionEl")).toBeVisible();

    await page.locator("#tabBtnCollections").click();
    await expect(page.locator("#collectionsSectionEl")).toBeVisible();
  });

  test("applyLayoutOrder reorders inside the tab views instead of ejecting sections", async ({
    page,
  }) => {
    // REGRESSION GUARD. applyLayoutOrder re-appends every section to reassert
    // DOM order and used to append to `.container`. Running at boot
    // (init.js), that hoisted all six sections out of the tab views: the
    // wrappers collapsed to zero height and every section rendered on every
    // tab. The symptom is deceptive — the page still looks populated, because
    // the sections are all there, just no longer tabbed.
    await gotoApp(page);
    await page.evaluate(() => window.applyLayoutOrder());

    const parents = await page.evaluate(() =>
      [
        "spotPricesSection",
        "bestPriceTickerEl",
        "totalsSectionEl",
        "searchSectionEl",
        "tableSectionEl",
        "vendorPricesSectionEl",
      ].map((id) => document.getElementById(id)?.closest(".tab-view")?.id ?? null)
    );

    expect(parents).toEqual([
      "tabViewDashboard",
      "tabViewDashboard",
      "tabViewDashboard",
      "tabViewInventory",
      "tabViewInventory",
      "tabViewMarket",
    ]);

    // And the shell still works afterwards.
    await expect(page.locator("#tabViewDashboard")).toBeVisible();
    await expect(page.locator("#tableSectionEl")).toBeHidden();
  });

  test("the inventory recovery banner is visible on boot even though it belongs to a hidden tab", async ({
    page,
  }) => {
    // REGRESSION GUARD. showInventoryRecoveryBanner mounted itself with
    // tableSection.parentNode.insertBefore(...). Before the shell that parent
    // was <main>, so the banner always showed. Wrapping #tableSectionEl in the
    // Inventory panel silently moved the mount point INTO a display:none
    // panel, so a user with unreadable inventory would land on Dashboard and
    // never see the data-loss warning. It now mounts above the panels.
    await page.addInitScript(() => {
      // Serial present + inventory key missing = the damaged-state path.
      localStorage.setItem("inventorySerial", "5");
      localStorage.removeItem("metalInventory");
    });
    await gotoApp(page);

    const banner = page.locator("#inventoryRecoveryBanner");
    await expect(banner).toBeVisible();

    // Still visible after switching tabs — it is a global alert, not tab content.
    await page.locator("#tabBtnMarket").click();
    await expect(banner).toBeVisible();
  });
});

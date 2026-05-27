import { test, expect } from "../../helpers/mocks/extended-test.js";

/**
 * STAK-576 ISSUE-005 — Numista search magnifier with no API key must surface
 * the "not configured" state, not a misleading "Enter a Name..." alert.
 *
 * Regression trap: the old click handler checked empty fields first and
 * returned `appAlert("Enter a Name or Catalog N# to search.")` even when a
 * name was typed, because the *real* blocker was the missing Numista key.
 * The new handler gates on `catalogConfig.isNumistaEnabled()` first and
 * offers to jump straight to Settings → API.
 */

test.describe("Numista search magnifier — not configured UX", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Wipe any previously saved catalog config so the test starts with
      // Numista genuinely unconfigured. Also suppress the What's New popup
      // so it does not intercept the Add Item click.
      localStorage.removeItem("catalog_api_config");
      localStorage.setItem("ackVersion", "9.9.9");
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#newItemBtn", { state: "visible" });
    await page.waitForTimeout(300); // let deferred setupEventListeners fire
    const whatsNew = page.locator("#whatsNewPopup");
    if (await whatsNew.isVisible().catch(() => false)) {
      await page.click("#whatsNewDismissBtn").catch(() => {});
    }
    // Open Add Inventory modal via JS click to bypass overlay interception
    await page.evaluate(() => document.getElementById("newItemBtn").click());
    await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
  });

  test("NC-1 — disconnected dot renders with not-configured tooltip on the button", async ({
    page,
  }) => {
    const state = await page.evaluate(() => {
      if (typeof window.updateNumistaModalDot === "function") window.updateNumistaModalDot();
      const btn = document.getElementById("searchNumistaBtn");
      const nameBtn = document.getElementById("searchNumistaNameBtn");
      const dot = btn?.querySelector(".numista-modal-status-dot");
      return {
        dotClasses: dot?.className || "",
        btnTitle: btn?.getAttribute("title") || "",
        nameBtnTitle: nameBtn?.getAttribute("title") || "",
      };
    });

    expect(state.dotClasses.split(/\s+/)).toContain("disconnected");
    expect(state.dotClasses.split(/\s+/)).not.toContain("connected");
    expect(state.btnTitle).toContain("not configured");
    expect(state.nameBtnTitle).toContain("not configured");
  });

  test("NC-2 — clicking the magnifier with a name typed opens the not-configured dialog, not the empty-field alert", async ({
    page,
  }) => {
    await page.fill("#itemName", "American Silver Eagle");
    await page.click("#searchNumistaNameBtn");

    // Wait for the real themed dialog to appear
    await expect(page.locator("#appDialogModal")).toBeVisible({ timeout: 5000 });

    const titleText = await page.locator("#appDialogTitle").textContent();
    const messageText = await page.locator("#appDialogMessage").textContent();

    expect(titleText).toMatch(/not configured/i);
    expect(messageText).toMatch(/Numista/i);
    expect(messageText).not.toMatch(/Enter a Name/i);

    // Dismiss via Cancel — we're only verifying dialog copy, not the handoff
    await page.click("#appDialogCancel");
    await expect(page.locator("#appDialogModal")).toBeHidden({ timeout: 3000 });
  });

  test("NC-3 — confirming opens Settings → API", async ({ page }) => {
    await page.fill("#itemName", "American Silver Eagle");
    await page.click("#searchNumistaBtn");

    // Wait for the real themed dialog to appear
    await expect(page.locator("#appDialogModal")).toBeVisible({ timeout: 5000 });

    // Click OK — resolver fires true and events.js calls showSettingsModal("api")
    await page.click("#appDialogOk");

    // The real side effect: settings modal becomes visible
    await expect(page.locator("#settingsModal")).toBeVisible({ timeout: 5000 });
  });
});

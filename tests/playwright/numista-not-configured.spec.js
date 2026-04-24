import { test, expect } from "@playwright/test";

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
    const messages = [];
    await page.exposeFunction("__captureDialog", (title, message) => {
      messages.push({ title, message });
    });
    await page.evaluate(() => {
      const originalConfirm = window.appConfirm;
      window.appConfirm = async (message, title) => {
        window.__captureDialog(title || "", message || "");
        return false; // user cancels — we just want to verify the message
      };
      window.__originalAppConfirm = originalConfirm;
    });

    await page.fill("#itemName", "American Silver Eagle");
    await page.click("#searchNumistaNameBtn");
    await page.waitForTimeout(150);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].title).toMatch(/not configured/i);
    expect(messages[0].message).toMatch(/Numista/i);
    expect(messages[0].message).not.toMatch(/Enter a Name/i);
  });

  test("NC-3 — confirming opens Settings → API", async ({ page }) => {
    // Stub appConfirm to auto-accept so we don't need to click the dialog
    await page.evaluate(() => {
      window.appConfirm = async () => true;
      window.showAppConfirm = async () => true;
    });

    await page.fill("#itemName", "American Silver Eagle");
    await page.click("#searchNumistaBtn");

    // The real side effect: settings modal becomes visible. Use the DOM
    // outcome instead of stubbing showSettingsModal — the module-scope
    // binding in events.js is not interceptable via window overrides.
    await expect(page.locator("#settingsModal")).toBeVisible({ timeout: 3000 });
  });
});

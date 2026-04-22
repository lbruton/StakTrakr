import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "./helpers/seed.js";

/**
 * STAK-446: Log / Changelog Redesign — tab rename, tab order, undo/redo for Added items, CRUD audit.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () => typeof window.editItem === "function" && Array.isArray(window.inventory)
  );
  await page.waitForTimeout(500);
}

async function dismissWhatsNew(page) {
  const whatsNew = page.locator("#whatsNewPopup");
  if (await whatsNew.isVisible()) {
    await page.click("#whatsNewDismissBtn");
  }
}

async function openSettings(page) {
  await dismissWhatsNew(page);
  await page.click("#settingsBtn");
  await expect(page.locator("#settingsModal")).toBeVisible({ timeout: 10000 });
}

async function navigateToActivityLog(page) {
  await openSettings(page);
  await page.click('[data-section="changelog"]');
  // Wait for the log tab bar to be visible
  await expect(page.locator(".settings-log-tabs")).toBeVisible();
}

async function openAddModal(page) {
  await dismissWhatsNew(page);
  await page.evaluate(() => document.getElementById("newItemBtn").click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

async function addSilverCoin(page, name = "CL-TEST-COIN") {
  await openAddModal(page);
  await page.selectOption("#itemMetal", "Silver");
  await page.selectOption("#itemType", "Coin");
  await page.fill("#itemName", name);
  await page.fill("#itemWeight", "1");
  await page.fill("#itemPrice", "30");
  await page.click("#itemModalSubmit");
  await expect(page.locator("#itemModal")).toBeHidden();
}

test.describe("STAK-446: Log/Changelog Redesign", () => {
  // ── REQ-1: Tab Rename ───────────────────────────────────────────────────

  test.describe("REQ-1: Tab Rename", () => {
    test("REQ-1a — 'Metals' tab is renamed to 'Spot Price'", async ({ page }) => {
      await injectSeedInventory(page);
      await gotoApp(page);
      await navigateToActivityLog(page);

      const metalsTab = page.locator('[data-log-tab="metals"]');
      await expect(metalsTab).toBeVisible();
      const text = await metalsTab.textContent();
      expect(text.trim()).toBe("Spot Price");
    });

    test("REQ-1b — 'Price History' tab is renamed to 'Item History'", async ({ page }) => {
      await injectSeedInventory(page);
      await gotoApp(page);
      await navigateToActivityLog(page);

      const priceHistoryTab = page.locator('[data-log-tab="pricehistory"]');
      await expect(priceHistoryTab).toBeVisible();
      const text = await priceHistoryTab.textContent();
      expect(text.trim()).toBe("Item History");
    });
  });

  // ── REQ-2: Tab Order ──────────────────────────────────────────────────

  test.describe("REQ-2: Tab Order", () => {
    test("REQ-2 — sub-tab DOM order matches spec", async ({ page }) => {
      await injectSeedInventory(page);
      await gotoApp(page);
      await navigateToActivityLog(page);

      const tabs = page.locator(".settings-log-tab");
      const tabValues = await tabs.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-log-tab"))
      );

      // Expected order per STAK-446 spec
      const expectedOrder = [
        "changelog",
        "catalogs",
        "cloud",
        "metals",
        "market",
        "pricehistory",
        "lbma",
      ];

      expect(tabValues).toEqual(expectedOrder);
    });
  });

  // ── REQ-3: Undo/Redo for Added Items ──────────────────────────────────

  test.describe("REQ-3: Undo/Redo for Added Items", () => {
    test("REQ-3a — adding an item creates a changelog entry with field 'Added'", async ({
      page,
    }) => {
      await injectSeedInventory(page);
      await gotoApp(page);

      const beforeCount = await page.evaluate(() => inventory.length);
      await addSilverCoin(page, "CL-UNDO-TEST");

      const afterCount = await page.evaluate(() => inventory.length);
      expect(afterCount).toBe(beforeCount + 1);

      const addedEntries = await page.evaluate(() =>
        changeLog.filter((e) => e.field === "Added" && e.itemName === "CL-UNDO-TEST")
      );
      expect(addedEntries.length).toBeGreaterThanOrEqual(1);
    });

    test("REQ-3b — undo on 'Added' entry removes item from inventory", async ({ page }) => {
      await injectSeedInventory(page);
      await gotoApp(page);
      await addSilverCoin(page, "CL-UNDO-ITEM");

      const countAfterAdd = await page.evaluate(() => inventory.length);

      // Find the "Added" entry index in changeLog
      const addedIdx = await page.evaluate(() =>
        changeLog.findIndex((e) => e.field === "Added" && e.itemName === "CL-UNDO-ITEM")
      );
      expect(addedIdx).toBeGreaterThanOrEqual(0);

      // Navigate to Activity Log → Changelog tab and click the undo button
      await navigateToActivityLog(page);
      await page.click('[data-log-tab="changelog"]');
      await page.waitForSelector("#settingsChangeLogTable tbody tr", { state: "visible" });

      // Click the undo button for the entry matching CL-UNDO-ITEM
      const undoBtn = page
        .locator("#settingsChangeLogTable tbody tr")
        .filter({ hasText: "CL-UNDO-ITEM" })
        .locator(".action-cell button");
      await undoBtn.click();

      const countAfterUndo = await page.evaluate(() => inventory.length);
      // Undo of "Added" should remove the item, decreasing count by 1
      expect(countAfterUndo).toBe(countAfterAdd - 1);
    });

    test("REQ-3c — redo after undo restores the item to inventory", async ({ page }) => {
      await injectSeedInventory(page);
      await gotoApp(page);
      await addSilverCoin(page, "CL-REDO-ITEM");

      const countAfterAdd = await page.evaluate(() => inventory.length);

      // Find and undo the "Added" entry
      const addedIdx = await page.evaluate(() =>
        changeLog.findIndex((e) => e.field === "Added" && e.itemName === "CL-REDO-ITEM")
      );
      expect(addedIdx).toBeGreaterThanOrEqual(0);

      // Navigate to Activity Log → Changelog tab and click Undo
      await navigateToActivityLog(page);
      await page.click('[data-log-tab="changelog"]');
      await page.waitForSelector("#settingsChangeLogTable tbody tr", { state: "visible" });
      const redoItemRow = page
        .locator("#settingsChangeLogTable tbody tr")
        .filter({ hasText: "CL-REDO-ITEM" });
      await redoItemRow.locator(".action-cell button").click();

      const countAfterUndo = await page.evaluate(() => inventory.length);
      expect(countAfterUndo).toBe(countAfterAdd - 1);

      // Click Redo (button label flips to "Redo" after undo)
      await redoItemRow.locator(".action-cell button").click();

      const countAfterRedo = await page.evaluate(() => inventory.length);
      expect(countAfterRedo).toBe(countAfterAdd);
    });
  });

  // ── REQ-4: CRUD Audit ────────────────────────────────────────────────

  test.describe("REQ-4: CRUD Audit", () => {
    test("REQ-4 — adding an item produces a changelog entry with field 'Added'", async ({
      page,
    }) => {
      await injectSeedInventory(page);
      await gotoApp(page);

      // Clear changelog first and persist to localStorage for consistency
      await page.evaluate(() => {
        if (typeof changeLog !== "undefined") {
          changeLog.length = 0;
          if (typeof saveDataSync === "function") saveDataSync("changeLog", changeLog);
        }
      });

      await addSilverCoin(page, "CL-AUDIT-ITEM");

      const entries = await page.evaluate(() => changeLog.filter((e) => e.field === "Added"));
      expect(entries.length).toBe(1);
      expect(entries[0].itemName).toBe("CL-AUDIT-ITEM");
    });
  });
});

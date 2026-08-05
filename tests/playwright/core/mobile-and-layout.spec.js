import { test, expect } from "../helpers/mocks/extended-test.js";

const BASE_ITEM = {
  uuid: "core-mobile-layout-item",
  metal: "Silver",
  composition: "Silver",
  name: "Core Mobile Layout Item",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 35,
  marketValue: 0,
  date: "2026-04-25",
  purchaseLocation: "StakTrakr",
  storageLocation: "Safe",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 32,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
  numistaData: { shape: "rectangular", composition: "Silver (.999)", length: 51, width: 89 },
  capsule: "Air-Tite A40",
};

const BULK_ITEMS = [
  BASE_ITEM,
  {
    ...BASE_ITEM,
    uuid: "core-mobile-layout-round",
    name: "Core Mobile Layout Round",
    serial: 2,
    numistaData: { shape: "round", composition: "Silver (.999)", diameter: 40.6 },
  },
];

async function seedInventory(page, items = [BASE_ITEM]) {
  await page.addInitScript((inventory) => {
    localStorage.setItem("metalInventory", JSON.stringify(inventory));
    localStorage.setItem("inventorySerial", String(inventory.length + 10));
    localStorage.setItem("itemTags", JSON.stringify({}));
    localStorage.setItem("cardViewStyle", "A");
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  }, items);
}

async function gotoApp(page) {
  // Deep-link into the Inventory tab (STRK-282): #newItemBtn lives in that
  // panel, and the v2 shell boots on Dashboard, so a bare /index.html leaves
  // this control display:none.
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.openBulkEdit === "function" &&
      typeof window.editItem === "function" &&
      typeof window.showViewModal === "function" &&
      typeof window.resolveImageFrame === "function" &&
      Array.isArray(window.inventory)
  );
}

async function openBulkEdit(page) {
  await page.evaluate(() => window.openBulkEdit());
  await expect(page.locator("#bulkEditModal")).toBeVisible();
  await page.waitForSelector("#bulkEditModal .bulk-edit-table tbody tr[data-serial]", {
    state: "attached",
  });
}

async function openEditModal(page, index = 0) {
  await page.evaluate((idx) => window.editItem(idx), index);
  await expect(page.locator("#itemModal")).toBeVisible();
}

async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

async function findRuleCssText(page, selector) {
  return page.evaluate((sel) => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (_e) {
        continue;
      }
      for (const rule of Array.from(rules || [])) {
        if (rule instanceof CSSStyleRule && rule.selectorText === sel) return rule.cssText;
      }
    }
    return null;
  }, selector);
}

test.describe("core/mobile-and-layout", () => {
  test("bulk editor opens on mobile and exposes catalog/capsule fields without raw JSON columns", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedInventory(page, BULK_ITEMS);
    await gotoApp(page);
    await openBulkEdit(page);

    await expect(page.locator("#bulkEditModal .bulk-edit-table")).toBeVisible();
    await expect(page.locator("#bulkField_shape")).toHaveCount(1);
    await expect(page.locator("#bulkField_capsule")).toHaveCount(1);
    await expect(page.locator("#bulkField_capsuleNotes")).toHaveCount(1);

    const headerTexts = await page
      .locator("#bulkEditModal .bulk-edit-table thead th")
      .allTextContents();
    expect(headerTexts.some((text) => /^\s*Numista Data\s*$/i.test(text))).toBe(false);
    expect(headerTexts).toContain("Catalog Composition");
    expect(headerTexts).toContain("Diameter");
  });

  test("mobile modal safe-area rules and viewport-fit cover remain wired", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);

    expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain(
      "viewport-fit=cover"
    );

    await openViewModal(page);
    expect(await findRuleCssText(page, ".view-modal-footer")).toContain(
      "env(safe-area-inset-bottom"
    );
    await page.evaluate(() => window.closeViewModal?.());

    await openEditModal(page);
    expect(await findRuleCssText(page, "#inventoryForm .item-modal-actions")).toContain(
      "env(safe-area-inset-bottom"
    );
  });

  test("edit modal keeps image, identity, metal, and denomination controls in order", async ({
    page,
  }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);
    await openEditModal(page);

    const order = await page.evaluate(() => {
      const form = document.getElementById("inventoryForm");
      const indexOf = (selector) =>
        Array.from(form.children).indexOf(document.querySelector(selector));
      return {
        image: indexOf("#imageUploadGroup"),
        nameYear: indexOf("#inventoryForm > .grid-name-year"),
        purityQtyWeight: indexOf("#inventoryForm > .grid-purity-row"),
      };
    });
    expect(order.image).toBeLessThan(order.nameYear);
    expect(order.nameYear).toBeLessThan(order.purityQtyWeight);

    await page.waitForFunction(
      () =>
        typeof toggleGbDenomPicker === "function" && document.getElementById("itemGbDenom") !== null
    );
    await page.selectOption("#itemWeightUnit", "gb");
    await expect(page.locator("#itemWeightLabel")).toHaveText("DENOMINATION");
    await expect(page.locator("#itemGbDenom")).toBeVisible();
  });

  test("image frame resolver and compact card/table rendering preserve rectangular items", async ({
    page,
  }) => {
    await seedInventory(page, [
      { ...BASE_ITEM, type: "Bar", obverseImageUrl: "https://images.example/obv.png" },
    ]);
    await page.route("https://images.example/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"></svg>',
      });
    });
    await gotoApp(page);

    const frames = await page.evaluate(() => ({
      explicitRect: window.resolveImageFrame(
        { type: "Coin", obverseImageFrame: "rectangle", numistaData: { shape: "round" } },
        "obverse"
      ),
      grading: window.resolveImageFrame({ type: "Coin", gradingAuthority: "PCGS" }, "obverse"),
      fallback: window.resolveImageFrame(
        { type: "Coin", numistaData: { shape: "round" } },
        "obverse"
      ),
    }));
    expect(frames).toEqual({ explicitRect: "rect", grading: "rect", fallback: "round" });

    await expect(page.locator(".card-a .coin-img.bar-shape").first()).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)"
    );
    await page.evaluate(() => {
      localStorage.setItem("cardViewStyle", "B");
      window.renderTable();
    });
    await expect(page.locator(".card-b .coin-img.bar-shape").first()).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)"
    );
  });
});

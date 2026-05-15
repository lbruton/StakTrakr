import { test, expect } from "../helpers/mocks/extended-test.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgQAAAABJRU5ErkJggg==",
  "base64"
);

const BASE_ITEM = {
  uuid: "strk-67-frame-item",
  metal: "Platinum",
  composition: "Platinum",
  name: "STRK-67 Frame Fixture",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 100,
  marketValue: 0,
  date: "2026-05-10",
  purchaseLocation: "StakTrakr",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2026",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 100,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.9995,
  numistaId: "",
  serial: 1,
  obverseImageUrl: "https://images.example/obv.png",
  reverseImageUrl: "https://images.example/rev.png",
};

async function seedInventory(page, items = [BASE_ITEM]) {
  await page.addInitScript((inventory) => {
    localStorage.setItem("metalInventory", JSON.stringify(inventory));
    localStorage.setItem("itemTags", JSON.stringify({}));
    localStorage.setItem("tableImagesEnabled", "true");
    localStorage.setItem("tableImageSides", "both");
    localStorage.setItem("cardViewStyle", "D");
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") {
          localStorage.setItem("ackVersion", APP_VERSION);
        }
      },
      { once: true }
    );
  }, items);
}

async function routeImages(page) {
  await page.route("https://images.example/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG })
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.resolveImageFrame === "function" &&
      typeof window.editItem === "function" &&
      Array.isArray(window.inventory) &&
      window.inventory.length > 0
  );
}

test.describe("image frame overrides — STRK-67", () => {
  test("resolver priority covers explicit overrides, existing rectangular rules, grading, Numista shape, and fallback", async ({
    page,
  }) => {
    await seedInventory(page);
    await gotoApp(page);

    const results = await page.evaluate(() => {
      const cases = [
        {
          name: "explicit circle wins",
          item: {
            type: "Bar",
            gradingAuthority: "NGC",
            obverseImageFrame: "circle",
            numistaData: { shape: "rectangular" },
          },
        },
        {
          name: "explicit rectangle wins",
          item: { type: "Coin", obverseImageFrame: "rectangle", numistaData: { shape: "round" } },
        },
        { name: "type rule", item: { type: "Note", numistaData: { shape: "round" } } },
        { name: "weight unit rule", item: { type: "Coin", weightUnit: "gb" } },
        { name: "grading rule", item: { type: "Coin", gradingAuthority: "PCGS" } },
        { name: "Numista shape rule", item: { type: "Coin", numistaData: { shape: "oval" } } },
        {
          name: "circular Numista shape fallback",
          item: { type: "Coin", numistaData: { shape: "circular" } },
        },
        { name: "fallback", item: { type: "Coin", numistaData: { shape: "round" } } },
      ];
      return cases.map((entry) => [entry.name, window.resolveImageFrame(entry.item, "obverse")]);
    });

    expect(Object.fromEntries(results)).toEqual({
      "explicit circle wins": "round",
      "explicit rectangle wins": "rect",
      "type rule": "rect",
      "weight unit rule": "rect",
      "grading rule": "rect",
      "Numista shape rule": "rect",
      "circular Numista shape fallback": "round",
      fallback: "round",
    });
  });

  test("table, card A/B/C, and view modal render mixed per-side frames consistently", async ({
    page,
  }) => {
    await seedInventory(page, [
      {
        ...BASE_ITEM,
        obverseImageFrame: "rectangle",
        reverseImageFrame: "circle",
      },
    ]);
    await routeImages(page);
    await gotoApp(page);

    const tableObv = page.locator('#inventoryTable img.table-thumb[data-side="obverse"]').first();
    const tableRev = page.locator('#inventoryTable img.table-thumb[data-side="reverse"]').first();
    await expect(tableObv).toHaveClass(/table-thumb-rect/);
    await expect(tableRev).not.toHaveClass(/table-thumb-rect/);

    await page.evaluate(() => {
      localStorage.setItem("cardViewStyle", "A");
      window.renderTable();
    });
    const cardAObv = page.locator('.coin-img:has(img[data-side="obverse"])').first();
    const cardARev = page.locator('.coin-img:has(img[data-side="reverse"])').first();
    await expect(cardAObv).toHaveClass(/bar-shape/);
    await expect(cardARev).not.toHaveClass(/bar-shape/);
    await expect(cardAObv.locator("img")).toHaveCSS("object-fit", "contain");
    await expect(cardARev.locator("img")).toHaveCSS("object-fit", "cover");

    await page.evaluate(() => {
      localStorage.setItem("cardViewStyle", "B");
      window.renderTable();
    });
    const cardBObv = page.locator('.coin-img:has(img[data-side="obverse"])').first();
    const cardBRev = page.locator('.coin-img:has(img[data-side="reverse"])').first();
    await expect(cardBObv).toHaveClass(/bar-shape/);
    await expect(cardBRev).not.toHaveClass(/bar-shape/);
    await expect(cardBObv).toHaveCSS("width", "80px");
    await expect(cardBObv).toHaveCSS("height", "80px");

    await page.evaluate(() => {
      localStorage.setItem("cardViewStyle", "C");
      window.renderTable();
    });
    const cardCObv = page.locator('.coin-img:has(img[data-side="obverse"])').first();
    const cardCRev = page.locator('.coin-img:has(img[data-side="reverse"])').first();
    await expect(cardCObv).toHaveClass(/bar-shape/);
    await expect(cardCRev).not.toHaveClass(/bar-shape/);
    await expect(cardCObv).toHaveCSS("width", "80px");
    await expect(cardCObv).toHaveCSS("height", "56px");

    await page.evaluate(() => window.showViewModal(0));
    await expect(
      page.locator('#viewImageSection .view-image-slot[data-side="obverse"]')
    ).toHaveClass(/view-shape-rect/);
    await expect(
      page.locator('#viewImageSection .view-image-slot[data-side="reverse"]')
    ).not.toHaveClass(/view-shape-rect/);
  });

  test("edit modal cycles, swaps, removes, previews URL images, and clears explicit overrides back to absent auto", async ({
    page,
  }) => {
    await seedInventory(page);
    await routeImages(page);
    await gotoApp(page);

    await page.evaluate(() => window.editItem(0));
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemImagePreviewObv")).toBeVisible();
    await expect(page.locator("#itemImagePreviewRev")).toBeVisible();

    const obvToggle = page.locator("#frameToggleObv");
    const revToggle = page.locator("#frameToggleRev");
    await obvToggle.click();
    await obvToggle.click();
    await revToggle.click();
    await expect(obvToggle).toHaveAttribute("data-frame-state", "rectangle");
    await expect(revToggle).toHaveAttribute("data-frame-state", "circle");

    await page.locator("#swapImagesBtn").click();
    await expect(obvToggle).toHaveAttribute("data-frame-state", "circle");
    await expect(revToggle).toHaveAttribute("data-frame-state", "rectangle");

    await page.locator("#itemImageRemoveBtnRev").click();
    await expect(revToggle).toHaveAttribute("data-frame-state", "auto");

    await page.locator("#itemModalSubmit").click();
    await expect(page.locator("#itemModal")).toBeHidden();
    expect(await page.evaluate(() => window.inventory[0].obverseImageFrame)).toBe("circle");
    expect(await page.evaluate(() => window.inventory[0].reverseImageFrame)).toBeUndefined();

    await page.evaluate(() => window.editItem(0));
    await expect(obvToggle).toHaveAttribute("data-frame-state", "circle");
    await obvToggle.click();
    await obvToggle.click();
    await expect(obvToggle).toHaveAttribute("data-frame-state", "auto");
    await page.locator("#itemModalSubmit").click();
    await expect(page.locator("#itemModal")).toBeHidden();
    expect(await page.evaluate(() => "obverseImageFrame" in window.inventory[0])).toBe(false);
  });
});

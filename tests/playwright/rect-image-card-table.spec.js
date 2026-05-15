import { test, expect } from "@playwright/test";

function decodeSvgDataUri(src) {
  if (!src || !src.startsWith("data:image/svg+xml")) return src;
  const commaIdx = src.indexOf(",");
  if (commaIdx === -1) return src;
  const payload = src.slice(commaIdx + 1);
  return decodeURIComponent(payload);
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgQAAAABJRU5ErkJggg==",
  "base64"
);

const BASE_ITEM = {
  uuid: "strk-38-rect-test",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-38 Rect Test Item",
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
  purity: 0.999,
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

/**
 * Force table thumbnails to load their placeholder (or CDN) src immediately.
 * Overrides imageCache.resolveImageUrlForItem to return null so the fallback
 * placeholder path is exercised without waiting for IDB.
 */
async function loadTableThumbs(page) {
  await page.evaluate(() => {
    if (window.imageCache && window.imageCache.resolveImageUrlForItem) {
      window.imageCache.resolveImageUrlForItem = async () => null;
    }
    document.querySelectorAll("#inventoryTable .table-thumb").forEach((img) => {
      img.scrollIntoView({ block: "nearest" });
    });
  });
}

test.describe("rectangular item image rendering — STRK-38", () => {
  // -------------------------------------------------------------------------
  // AC-1: Card A rect item
  // -------------------------------------------------------------------------
  test("Card A rect item has transparent background, 44x44px container, and object-fit contain", async ({
    page,
  }) => {
    await seedInventory(page, [
      { ...BASE_ITEM, type: "Bar", obverseImageUrl: "https://images.example/obv.png" },
    ]);
    await routeImages(page);
    await gotoApp(page);

    await page.evaluate(() => {
      localStorage.setItem("cardViewStyle", "A");
      window.renderTable();
    });

    const container = page.locator(".card-a .coin-img.bar-shape").first();
    await expect(container).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(container).toHaveCSS("width", "44px");
    await expect(container).toHaveCSS("height", "44px");

    const img = container.locator("img");
    await expect(img).toHaveCSS("object-fit", "contain");
  });

  // -------------------------------------------------------------------------
  // AC-2: Card B rect item
  // -------------------------------------------------------------------------
  test("Card B rect item has transparent background and 80x80px container", async ({ page }) => {
    await seedInventory(page, [
      { ...BASE_ITEM, type: "Bar", obverseImageUrl: "https://images.example/obv.png" },
    ]);
    await routeImages(page);
    await gotoApp(page);

    await page.evaluate(() => {
      localStorage.setItem("cardViewStyle", "B");
      window.renderTable();
    });

    const container = page.locator(".card-b .coin-img.bar-shape").first();
    await expect(container).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(container).toHaveCSS("width", "80px");
    await expect(container).toHaveCSS("height", "80px");
  });

  // -------------------------------------------------------------------------
  // AC-3: Card C rect item
  // -------------------------------------------------------------------------
  test("Card C rect item has transparent background and 80x56px container", async ({ page }) => {
    await seedInventory(page, [
      { ...BASE_ITEM, type: "Bar", obverseImageUrl: "https://images.example/obv.png" },
    ]);
    await routeImages(page);
    await gotoApp(page);

    await page.evaluate(() => {
      localStorage.setItem("cardViewStyle", "C");
      window.renderTable();
    });

    const container = page.locator(".card-c .coin-img.bar-shape").first();
    await expect(container).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(container).toHaveCSS("width", "80px");
    await expect(container).toHaveCSS("height", "56px");
  });

  // -------------------------------------------------------------------------
  // AC-4: Table rect thumbnail
  // -------------------------------------------------------------------------
  test("Table rect thumbnail has transparent background", async ({ page }) => {
    await seedInventory(page, [{ ...BASE_ITEM, type: "Bar" }]);
    await routeImages(page);
    await gotoApp(page);

    const thumb = page.locator("#inventoryTable img.table-thumb.table-thumb-rect").first();
    await expect(thumb).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  // -------------------------------------------------------------------------
  // AC-5: Table no-image placeholder for rect item
  // -------------------------------------------------------------------------
  test.describe("Table no-image placeholder uses rect SVG for rect items", () => {
    test("manual obverseImageFrame: rectangle override", async ({ page }) => {
      await seedInventory(page, [
        {
          ...BASE_ITEM,
          obverseImageFrame: "rectangle",
          obverseImageUrl: "",
          reverseImageUrl: "",
        },
      ]);
      await gotoApp(page);
      await loadTableThumbs(page);

      const thumb = page.locator('#inventoryTable img.table-thumb[data-side="obverse"]').first();
      await expect(thumb).toHaveClass(/table-thumb-rect/);
      await expect(thumb).toHaveAttribute("src", /^data:image\/svg/);

      const src = await thumb.getAttribute("src");
      const decoded = decodeSvgDataUri(src);
      expect(decoded).toContain("<rect");
      expect(decoded).not.toContain("<circle");
    });

    test("grading-authority-driven rect", async ({ page }) => {
      await seedInventory(page, [
        {
          ...BASE_ITEM,
          gradingAuthority: "PCGS",
          obverseImageUrl: "",
          reverseImageUrl: "",
        },
      ]);
      await gotoApp(page);
      await loadTableThumbs(page);

      const thumb = page.locator('#inventoryTable img.table-thumb[data-side="obverse"]').first();
      await expect(thumb).toHaveClass(/table-thumb-rect/);
      await expect(thumb).toHaveAttribute("src", /^data:image\/svg/);

      const src = await thumb.getAttribute("src");
      const decoded = decodeSvgDataUri(src);
      expect(decoded).toContain("<rect");
    });

    test("Numista non-round shape", async ({ page }) => {
      await seedInventory(page, [
        {
          ...BASE_ITEM,
          numistaData: { shape: "Square" },
          obverseImageUrl: "",
          reverseImageUrl: "",
        },
      ]);
      await gotoApp(page);
      await loadTableThumbs(page);

      const thumb = page.locator('#inventoryTable img.table-thumb[data-side="obverse"]').first();
      await expect(thumb).toHaveClass(/table-thumb-rect/);
      await expect(thumb).toHaveAttribute("src", /^data:image\/svg/);

      const src = await thumb.getAttribute("src");
      const decoded = decodeSvgDataUri(src);
      expect(decoded).toContain("<rect");
    });
  });

  // -------------------------------------------------------------------------
  // AC-6: Round coin in all views — rendering unchanged
  // -------------------------------------------------------------------------
  test.describe("Round coin rendering is unchanged across all views", () => {
    test("Card A round coin has circular mask, theme background, and object-fit cover", async ({
      page,
    }) => {
      await seedInventory(page, [BASE_ITEM]);
      await routeImages(page);
      await gotoApp(page);

      await page.evaluate(() => {
        localStorage.setItem("cardViewStyle", "A");
        window.renderTable();
      });

      const container = page.locator(".card-a .coin-img").first();
      await expect(container).not.toHaveClass(/bar-shape/);
      await expect(container).toHaveCSS("border-radius", "50%");

      const bg = await container.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");

      const img = container.locator("img");
      await expect(img).toHaveCSS("object-fit", "cover");
    });

    test("Card B round coin has circular mask, theme background, and object-fit cover", async ({
      page,
    }) => {
      await seedInventory(page, [BASE_ITEM]);
      await routeImages(page);
      await gotoApp(page);

      await page.evaluate(() => {
        localStorage.setItem("cardViewStyle", "B");
        window.renderTable();
      });

      const container = page.locator(".card-b .coin-img").first();
      await expect(container).not.toHaveClass(/bar-shape/);
      await expect(container).toHaveCSS("border-radius", "50%");

      const bg = await container.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");

      const img = container.locator("img");
      await expect(img).toHaveCSS("object-fit", "cover");
    });

    test("Card C round coin has circular mask, theme background, and object-fit cover", async ({
      page,
    }) => {
      await seedInventory(page, [BASE_ITEM]);
      await routeImages(page);
      await gotoApp(page);

      await page.evaluate(() => {
        localStorage.setItem("cardViewStyle", "C");
        window.renderTable();
      });

      const container = page.locator(".card-c .coin-img").first();
      await expect(container).not.toHaveClass(/bar-shape/);
      await expect(container).toHaveCSS("border-radius", "50%");

      const bg = await container.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");

      const img = container.locator("img");
      await expect(img).toHaveCSS("object-fit", "cover");
    });

    test("Table round coin thumbnail has circular mask, theme background, and object-fit cover", async ({
      page,
    }) => {
      await seedInventory(page, [BASE_ITEM]);
      await routeImages(page);
      await gotoApp(page);

      const thumb = page.locator("#inventoryTable img.table-thumb").first();
      await expect(thumb).not.toHaveClass(/table-thumb-rect/);
      await expect(thumb).toHaveCSS("border-radius", "50%");

      const bg = await thumb.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
      await expect(thumb).toHaveCSS("object-fit", "cover");
    });
  });
});

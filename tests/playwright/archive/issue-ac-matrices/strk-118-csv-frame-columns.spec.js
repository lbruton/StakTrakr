import { test, expect } from "../../helpers/mocks/extended-test.js";

const FRAME_ITEM = {
  uuid: "strk101-frame-export",
  serial: 101,
  metal: "Silver",
  composition: "Silver",
  name: "STRK-101 Frame Export",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 30,
  date: "2026-05-23",
  purchaseLocation: "Desk",
  storageLocation: "Safe",
  obverseImageUrl: "https://images.example/obv.png",
  reverseImageUrl: "https://images.example/rev.png",
  obverseImageFrame: "rectangle",
  reverseImageFrame: "circle",
};

async function seedFrameInventory(page) {
  await page.addInitScript((item) => {
    localStorage.setItem("metalInventory", JSON.stringify([item]));
    localStorage.setItem("itemTags", JSON.stringify({}));
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  }, FRAME_ITEM);
}

function parseCsvInPage(page, csvText) {
  return page.evaluate((text) => {
    const normalized = text
      .split("\n")
      .filter((line) => !line.startsWith("# exportOrigin:"))
      .join("\n");
    return window.Papa.parse(normalized, { header: true, skipEmptyLines: true }).data[0];
  }, csvText);
}

function expectFrameColumns(row) {
  const headers = Object.keys(row);
  const reverseUrlIndex = headers.indexOf("Reverse Image URL");
  expect(headers.slice(reverseUrlIndex + 1, reverseUrlIndex + 3)).toEqual([
    "Obverse Frame",
    "Reverse Frame",
  ]);
  expect(row["Obverse Frame"]).toBe("rectangle");
  expect(row["Reverse Frame"]).toBe("circle");
}

test.describe("STRK-101 — CSV frame export columns", () => {
  test.beforeEach(async ({ page }) => {
    await seedFrameInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.createBackupZip === "function" &&
        typeof window.exportInventoryCSV === "function" &&
        typeof window.Papa !== "undefined"
    );
  });

  test("ZIP CSV includes frame columns immediately after Reverse Image URL", async ({ page }) => {
    const csvText = await page.evaluate(async () => {
      const blob = await window.createBackupZip();
      const zip = await window.JSZip.loadAsync(await blob.arrayBuffer());
      return zip.file("inventory_export.csv").async("string");
    });
    const row = await parseCsvInPage(page, csvText);
    expectFrameColumns(row);
  });

  test("standalone CSV includes frame columns immediately after Reverse Image URL", async ({
    page,
  }) => {
    const csvText = await page.evaluate(() => window.exportInventoryCSV());
    const row = await parseCsvInPage(page, csvText);
    expectFrameColumns(row);
  });
});

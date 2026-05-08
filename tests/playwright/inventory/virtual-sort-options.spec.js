import { expect, test } from "@playwright/test";

const BASE_ITEM = {
  metal: "Silver",
  composition: "Silver",
  name: "STRK-47 Sort Item",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 25,
  marketValue: 0,
  date: "2026-05-01",
  purchaseLocation: "Test Source",
  storageLocation: "Vault B",
  serialNumber: "",
  notes: "",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 30,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
};

const SPOT_ENTRY = {
  timestamp: "2026-05-01T12:00:00.000Z",
  metal: "Silver",
  spot: 30,
  source: "seed",
  provider: "Playwright",
};

async function seedInventory(page, inventory, sortColumn = "4", sortDir = "asc") {
  await page.route("https://open.er-api.com/v6/latest/USD", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "success", base_code: "USD", rates: { EUR: 0.9 } }),
    });
  });

  await page.addInitScript(
    ({ seededInventory, column, direction, history }) => {
      localStorage.setItem("metalInventory", JSON.stringify(seededInventory));
      localStorage.setItem("itemTags", JSON.stringify({}));
      localStorage.setItem("cardViewStyle", "D");
      localStorage.setItem("displayCurrency", JSON.stringify("USD"));
      localStorage.setItem("exchangeRates", JSON.stringify({ EUR: 0.9 }));
      localStorage.setItem("metalSpotHistory", JSON.stringify(history));
      localStorage.setItem("defaultSortColumn", column);
      localStorage.setItem("defaultSortDir", direction);

      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") {
            localStorage.setItem("ackVersion", APP_VERSION);
          }
        },
        { once: true }
      );
    },
    { seededInventory: inventory, column: sortColumn, direction: sortDir, history: [SPOT_ENTRY] }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#inventoryTable tbody tr", { state: "visible" });
  await page.waitForFunction(() => Array.isArray(window.inventory));
}

async function visibleNames(page) {
  return page.locator("#inventoryTable tbody tr [data-column='name']").allTextContents();
}

test.describe("STRK-47 virtual sort options", () => {
  test("adds Storage and Year to both sort dropdowns as virtual values", async ({ page }) => {
    await seedInventory(page, [{ ...BASE_ITEM, uuid: "strk-47-one" }]);
    await gotoApp(page);

    await expect(page.locator("#cardSortColumn option[value='102']")).toHaveText("Storage");
    await expect(page.locator("#cardSortColumn option[value='103']")).toHaveText("Year");
    await expect(page.locator("#settingsDefaultSortColumn option[value='102']")).toHaveText(
      "Storage"
    );
    await expect(page.locator("#settingsDefaultSortColumn option[value='103']")).toHaveText("Year");
  });

  test("sorts rows by inline Storage chip from the dropdown", async ({ page }) => {
    const items = [
      { ...BASE_ITEM, uuid: "strk-47-vault-c", name: "Storage C", storageLocation: "Vault C" },
      { ...BASE_ITEM, uuid: "strk-47-vault-a", name: "Storage A", storageLocation: "Vault A" },
      { ...BASE_ITEM, uuid: "strk-47-vault-b", name: "Storage B", storageLocation: "Vault B" },
    ];
    await seedInventory(page, items);
    await gotoApp(page);

    await page.selectOption("#cardSortColumn", "102");

    await expect
      .poll(async () => {
        const names = await visibleNames(page);
        return [
          names.findIndex((text) => text.includes("Storage A")),
          names.findIndex((text) => text.includes("Storage B")),
          names.findIndex((text) => text.includes("Storage C")),
        ];
      })
      .toEqual([0, 1, 2]);
    const names = await visibleNames(page);
    expect(names.findIndex((text) => text.includes("Storage A"))).toBeLessThan(
      names.findIndex((text) => text.includes("Storage B"))
    );
    expect(names.findIndex((text) => text.includes("Storage B"))).toBeLessThan(
      names.findIndex((text) => text.includes("Storage C"))
    );
  });

  test("sorts rows by inline Year chip with missing values last", async ({ page }) => {
    const items = [
      { ...BASE_ITEM, uuid: "strk-47-year-missing", name: "Year Missing", year: "" },
      { ...BASE_ITEM, uuid: "strk-47-year-2020", name: "Year 2020", year: "2020" },
      { ...BASE_ITEM, uuid: "strk-47-year-2025", name: "Year 2025", year: "2025" },
      { ...BASE_ITEM, uuid: "strk-47-year-unknown", name: "Year Unknown", year: "Unknown" },
    ];
    await seedInventory(page, items, "103", "desc");
    await gotoApp(page);

    const names = await visibleNames(page);
    expect(names.findIndex((text) => text.includes("Year 2025"))).toBeLessThan(
      names.findIndex((text) => text.includes("Year 2020"))
    );
    expect(names.findIndex((text) => text.includes("Year 2020"))).toBeLessThan(
      names.findIndex((text) => text.includes("Year Missing"))
    );
    expect(names.findIndex((text) => text.includes("Year 2020"))).toBeLessThan(
      names.findIndex((text) => text.includes("Year Unknown"))
    );
  });
});

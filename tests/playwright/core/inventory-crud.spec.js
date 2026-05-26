import { test, expect } from "../helpers/mocks/extended-test.js";

const SEED_ITEM = {
  uuid: "core-required-metal-type",
  metal: "Silver",
  composition: "Silver",
  name: "Core Silver Coin",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 0,
  date: "2026-01-01",
  purchaseLocation: "staktrakr.com",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2026",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 0,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
};

const seedAndGoto = async (page) => {
  await page.addInitScript((item) => {
    localStorage.setItem("metalInventory", JSON.stringify([item]));
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") {
          localStorage.setItem("ackVersion", APP_VERSION);
        }
      },
      { once: true }
    );
  }, SEED_ITEM);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () => typeof window.editItem === "function" && Array.isArray(window.inventory)
  );
};

const openAddModal = async (page) => {
  await page.evaluate(() => {
    document.getElementById("inventoryForm")?.reset();
    const metal = document.getElementById("itemMetal");
    const type = document.getElementById("itemType");
    if (metal) metal.value = "";
    if (type) type.value = "";
    if (typeof window.filterTypesByMetal === "function") window.filterTypesByMetal("");
    if (typeof window.openModalById === "function") {
      window.openModalById("itemModal");
    } else {
      document.getElementById("itemModal").style.display = "flex";
    }
  });
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
};

test.describe("core/inventory-crud", () => {
  test("Add Item requires explicit Metal and Type selections", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    await expect(page.locator("#itemMetal")).toHaveValue("");
    await expect(page.locator("#itemType")).toHaveValue("");
    await expect(page.locator("#itemMetal")).toHaveAttribute("required", "");
    await expect(page.locator("#itemType")).toHaveAttribute("required", "");

    await page.fill("#itemName", "CORE-NO-METAL");
    await page.fill("#itemWeight", "1");
    expect(
      await page.evaluate(() => document.getElementById("inventoryForm").checkValidity())
    ).toBe(false);
  });

  test("Edit Item preselects existing Metal and Type values", async ({ page }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.editItem(0));
    await expect(page.locator("#itemModal")).toBeVisible();

    await expect(page.locator("#itemMetal")).toHaveValue("Silver");
    await expect(page.locator("#itemType")).toHaveValue("Coin");
  });
});

import { test, expect } from "./helpers/mocks/extended-test.js";

const CAPSULE_ITEM = {
  uuid: "strk46-capsule-item",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-46 Capsule Fixture",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 40,
  marketValue: 0,
  date: "2026-05-08",
  purchaseLocation: "StakTrakr",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  capsule: "X-38-Ring",
  capsuleNotes: "Guardhouse 38mm - tight fit",
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
  numistaData: { diameter: 38, shape: "Round" },
  serial: 1,
};

async function seedInventory(page, items = []) {
  await page.addInitScript((inventory) => {
    localStorage.setItem("metalInventory", JSON.stringify(inventory));
    localStorage.setItem("itemTags", JSON.stringify({}));
    localStorage.setItem("numistaViewFields", JSON.stringify({}));

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

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      Array.isArray(window.inventory) &&
      typeof window.showViewModal === "function" &&
      typeof window.exportJson === "function" &&
      typeof window.importJsonFromText === "function" &&
      typeof window.filterInventory === "function"
  );
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForTimeout(500);
}

async function openAddModal(page) {
  await page.evaluate(() => document.getElementById("newItemBtn").click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

function catalogDetail(page, label) {
  return page
    .locator(".view-numista-section .view-detail-item")
    .filter({ has: page.locator(".view-detail-label", { hasText: new RegExp(`^${label}$`) }) })
    .first();
}

test.describe("STRK-46 capsule field", () => {
  test("saves capsule fields and updates suggestion/autocomplete from diameter", async ({
    page,
  }) => {
    await seedInventory(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "STRK-46 Saved Capsule");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "40");

    await page.fill("#numistaDiameter", "38");
    await expect(page.locator("#capsuleSuggestion")).toHaveText(/Suggested: X-38-DF \(38mm\)/);

    await page.fill("#numistaDiameter", "38.04");
    await expect(page.locator("#capsuleSuggestion")).toHaveText(/Suggested: H-38-DF \(38.1mm\)/);

    await page.selectOption("#numistaShape", "Rectangular");
    await expect(page.locator("#capsuleSuggestion")).toHaveText("");

    await page.selectOption("#numistaShape", "Round");
    await page.fill("#numistaDiameter", ".5");
    await expect(page.locator("#capsuleSuggestion")).toHaveText(/Suggested: A-16\.5-DF \(16.5mm\)/);

    await page.fill("#itemCapsule", "X-38");
    await expect(page.locator(".autocomplete-dropdown .autocomplete-item").first()).toContainText(
      "X-38"
    );
    await page.fill("#itemCapsule", "X-38-Ring");
    await page.fill("#itemCapsuleNotes", "Guardhouse 38mm - tight fit");
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).toBeHidden();

    const saved = await page.evaluate(() =>
      window.inventory.find((item) => item.name === "STRK-46 Saved Capsule")
    );
    expect(saved.capsule).toBe("X-38-Ring");
    expect(saved.capsuleNotes).toBe("Guardhouse 38mm - tight fit");
  });

  test("shows capsule data in the view modal without requiring a catalog id", async ({ page }) => {
    await seedInventory(page, [CAPSULE_ITEM]);
    await gotoApp(page);

    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator("#viewItemModal")).toBeVisible();
    await expect(page.locator(".view-numista-section")).toBeVisible();
    await expect(catalogDetail(page, "Capsule")).toContainText("X-38-Ring");
    await expect(catalogDetail(page, "Capsule Notes")).toContainText("Guardhouse 38mm");
  });

  test("search and JSON backup round-trip preserve capsule fields", async ({ page }) => {
    await seedInventory(page, [
      CAPSULE_ITEM,
      { ...CAPSULE_ITEM, uuid: "strk46-control-item", name: "STRK-46 Control", capsule: "" },
    ]);
    await gotoApp(page);

    await page.fill("#searchInput", "X-38-Ring");
    await page.waitForFunction(() => window.filterInventory().length === 1);
    const searchResult = await page.evaluate(() =>
      window.filterInventory().map((item) => item.uuid)
    );
    expect(searchResult).toEqual([CAPSULE_ITEM.uuid]);

    const exportPayload = await page.evaluate(() => {
      return new Promise((resolve) => {
        const originalCreateObjectUrl = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
          const reader = new FileReader();
          reader.onload = () => {
            URL.createObjectURL = originalCreateObjectUrl;
            resolve(JSON.parse(reader.result));
          };
          reader.readAsText(blob);
          return originalCreateObjectUrl.call(URL, blob);
        };
        window.exportJson();
      });
    });

    const exported = exportPayload.items.find((item) => item.uuid === CAPSULE_ITEM.uuid);
    expect(exported.capsule).toBe("X-38-Ring");
    expect(exported.capsuleNotes).toBe("Guardhouse 38mm - tight fit");

    await page.evaluate((payload) => {
      window.importJsonFromText(JSON.stringify(payload), true);
    }, exportPayload);
    await page.waitForFunction(
      (uuid) => window.inventory.some((item) => item.uuid === uuid),
      CAPSULE_ITEM.uuid
    );

    const restored = await page.evaluate((uuid) => {
      return window.inventory.find((item) => item.uuid === uuid);
    }, CAPSULE_ITEM.uuid);
    expect(restored.capsule).toBe("X-38-Ring");
    expect(restored.capsuleNotes).toBe("Guardhouse 38mm - tight fit");
  });
});

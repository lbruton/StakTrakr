import { test, expect } from "../../helpers/mocks/extended-test.js";

const legacySilverback = {
  uuid: "strk-17-legacy-silverback",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-17 Legacy Silverback",
  qty: 1,
  type: "Silverback",
  weight: 1,
  weightUnit: "gb",
  price: 0,
  marketValue: 0,
  date: "2026-04-29",
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
  serial: 17,
};

const migratedSilverback = {
  ...legacySilverback,
  uuid: "strk-17-migrated-silverback",
  name: "STRK-17 Migrated Silverback",
  weightUnit: "sb",
  serial: 18,
};

const goldbackItem = {
  ...legacySilverback,
  uuid: "strk-17-goldback-control",
  metal: "Gold",
  composition: "Gold",
  name: "STRK-17 Goldback Control",
  type: "Goldback",
  weight: 5,
  weightUnit: "gb",
  purity: 1,
  serial: 19,
};

async function seedData(page, inventory = []) {
  await page.addInitScript(
    ({ inv }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inv));
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
    { inv: inventory }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.editItem === "function" &&
      typeof window.openBulkEdit === "function" &&
      Array.isArray(window.inventory)
  );
  await page.waitForTimeout(500);
}

async function dismissWhatsNew(page) {
  const whatsNew = page.locator("#whatsNewPopup");
  if (await whatsNew.isVisible()) {
    await page.click("#whatsNewDismissBtn");
  }
}

async function openAddModal(page) {
  await dismissWhatsNew(page);
  await page.evaluate(() => document.getElementById("newItemBtn").click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

async function openBulkEditModal(page) {
  await dismissWhatsNew(page);
  await page.evaluate(() => {
    if (typeof window.openBulkEdit === "function") {
      window.openBulkEdit();
      return;
    }
    document.getElementById("bulkEditBtn")?.click();
  });
  await expect(page.locator("#bulkEditModal")).toBeVisible({ timeout: 10000 });
}

test.describe("STRK-17 Silverback weight unit and pricing", () => {
  test("REQ-1 AC-1 — weight unit dropdown exposes sb option", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await expect(page.locator('#itemWeightUnit option[value="sb"]')).toHaveCount(1);
    await expect(page.locator('#itemWeightUnit option[value="sb"]')).toHaveText("silverback");
  });

  test("REQ-1 AC-2 and REQ-3 AC-1/2 — Silverback auto-selects sb and hides denomination picker", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Silverback");

    await expect(page.locator("#itemWeightUnit")).toHaveValue("sb");
    await expect(page.locator("#itemGbDenom")).toBeHidden();

    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");

    await expect(page.locator("#itemWeightUnit")).toHaveValue("gb");
    await expect(page.locator("#itemGbDenom")).toBeVisible();
  });

  test("REQ-1 AC-3 — Silverback weight displays as 1 sb in table, card, and view modal", async ({
    page,
  }) => {
    await seedData(page, [migratedSilverback]);
    await gotoApp(page);

    await expect(
      page.locator('#inventoryTable tbody [data-column="weight"]').first()
    ).toContainText("1 sb");
    await page.click('#cardStyleToggle [data-style="A"]');
    await expect(page.locator("#cardViewGrid .cv-chip-weight").first()).toContainText("1 sb");

    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator("#viewItemModal")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#viewItemModal")).toContainText("1 sb");
  });

  test("REQ-2 AC-1/2/3 — sb retail falls through to melt, not Goldback denomination pricing", async ({
    page,
  }) => {
    await seedData(page, [migratedSilverback]);
    await gotoApp(page);
    await page.waitForFunction(() => typeof window.calculateRetailPrice === "function");

    const valuation = await page.evaluate(() => {
      const item = window.inventory[0];
      return window.calculateRetailPrice(item, 25);
    });

    expect(valuation.gbDenomPrice).toBeNull();
    expect(valuation.meltValue).toBeCloseTo(0.024975, 6);
    expect(valuation.retailTotal).toBeCloseTo(0.024975, 6);
  });

  test("REQ-1 AC-4 and REQ-3 AC-1 — bulk edit Silverback selects sb and hides denomination picker", async ({
    page,
  }) => {
    await seedData(page, [migratedSilverback]);
    await gotoApp(page);
    await openBulkEditModal(page);

    await page.click("#bulkField_metal");
    await page.click("#bulkField_type");
    await page.click("#bulkField_weight");
    await page.click("#bulkField_weightUnit");

    await page.selectOption("#bulkFieldVal_metal", "Silver");
    await page.selectOption("#bulkFieldVal_type", "Silverback");

    await expect(page.locator("#bulkFieldVal_weightUnit")).toHaveValue("sb");
    await expect(page.locator("#bulkFieldVal_weightDenom")).toBeHidden();

    await page.selectOption("#bulkFieldVal_type", "Coin");
    await expect(page.locator("#bulkFieldVal_weightUnit")).toHaveValue("oz");
  });

  test("REQ-3 AC-2 — Goldback denomination picker remains available", async ({ page }) => {
    await seedData(page, [goldbackItem]);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");

    const options = await page.evaluate(() => {
      const select = document.getElementById("itemGbDenom");
      return Array.from(select.options).map((option) => option.textContent);
    });

    await expect(page.locator("#itemGbDenom")).toBeVisible();
    expect(options).toContain("1 Goldback");
    expect(options).toContain("100 Goldback");
  });

  test("REQ-4 AC-1/2/3 — load migration rewrites existing Silverback gb items to sb", async ({
    page,
  }) => {
    await seedData(page, [legacySilverback]);
    await gotoApp(page);

    const stored = await page.evaluate(() => ({
      runtimeUnit: window.inventory[0].weightUnit,
      storedUnit: JSON.parse(localStorage.getItem("metalInventory"))[0].weightUnit,
    }));

    expect(stored.runtimeUnit).toBe("sb");
    expect(stored.storedUnit).toBe("sb");

    await page.reload();
    await page.waitForFunction(() => Array.isArray(window.inventory) && window.inventory.length);
    await expect.poll(async () => page.evaluate(() => window.inventory[0].weightUnit)).toBe("sb");
  });

  test("REQ-5 AC-1 — imported JSON migrates legacy Silverback gb items to sb", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await page.waitForFunction(() => typeof window.importJsonFromText === "function");

    await page.evaluate((item) => {
      window.importJsonFromText(JSON.stringify([item]), true);
    }, legacySilverback);

    await page.waitForFunction(
      () => window.inventory.some((item) => item.name === "STRK-17 Legacy Silverback"),
      null,
      { timeout: 10000 }
    );

    const imported = await page.evaluate(() =>
      window.inventory.find((item) => item.name === "STRK-17 Legacy Silverback")
    );
    expect(imported.weightUnit).toBe("sb");
  });

  test("STRK-15 — #itemGbDenom has no stale Goldback aria-label when Type=Silverback", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Silverback");

    await expect(page.locator("#itemGbDenom")).not.toHaveAttribute("aria-label", /Goldback/i);
  });

  test("REQ-5 AC-2 — encrypted backup preview migrates legacy Silverback gb items to sb", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await page.waitForFunction(
      () =>
        typeof window.vaultEncryptToBytes === "function" &&
        typeof window.vaultRestoreWithPreview === "function" &&
        typeof window.DiffEngine?.compareItems === "function" &&
        typeof window.DiffModal?.show === "function"
    );

    const remoteUnit = await page.evaluate(async (item) => {
      localStorage.setItem("metalInventory", JSON.stringify([item]));
      const bytes = Array.from(await window.vaultEncryptToBytes("strk17-password"));
      localStorage.setItem("metalInventory", JSON.stringify([]));
      window.inventory = [];

      let capturedUnit = null;
      const originalCompare = window.DiffEngine.compareItems;
      const originalShow = window.DiffModal.show;
      window.DiffEngine.compareItems = (_localItems, backupItems) => {
        capturedUnit = backupItems[0]?.weightUnit || null;
        return { added: [], modified: [], deleted: [], unchanged: backupItems };
      };
      window.DiffModal.show = () => {};

      try {
        await window.vaultRestoreWithPreview(new Uint8Array(bytes), "strk17-password");
      } finally {
        window.DiffEngine.compareItems = originalCompare;
        window.DiffModal.show = originalShow;
      }

      return capturedUnit;
    }, legacySilverback);

    expect(remoteUnit).toBe("sb");
  });
});

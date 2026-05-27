import { test, expect } from "../../helpers/mocks/extended-test.js";

const SEED_ITEM = {
  uuid: "stak580-seed-item",
  metal: "Silver",
  composition: "Silver",
  name: "STAK580 Silver Coin",
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

async function seedAndGoto(page) {
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
  await page.waitForTimeout(300);
  const popup = page.locator("#whatsNewPopup");
  if (await popup.isVisible()) {
    await page.click("#whatsNewDismissBtn");
  }
}

async function openAddModal(page) {
  await page.evaluate(() => document.getElementById("newItemBtn").click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

async function closeModal(page) {
  await page.evaluate(() => {
    const modal = document.getElementById("itemModal");
    if (modal) modal.style.display = "none";
  });
  await expect(page.locator("#itemModal")).toBeHidden();
}

test.describe("STAK-580 — required Metal/Type selection", () => {
  test("1. Add modal opens with empty placeholder for Metal and Type", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    await expect(page.locator("#itemMetal")).toHaveValue("");
    await expect(page.locator("#itemType")).toHaveValue("");
    await expect(page.locator("#itemMetal")).toHaveAttribute("required", "");
    await expect(page.locator("#itemType")).toHaveAttribute("required", "");
  });

  test("2. Native form validity blocks save when Metal or Type empty", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    await page.fill("#itemName", "STAK580-NO-METAL");
    await page.fill("#itemWeight", "1");

    const formValid = await page.evaluate(() =>
      document.getElementById("inventoryForm").checkValidity()
    );
    expect(formValid).toBe(false);

    const metalValid = await page.evaluate(() =>
      document.getElementById("itemMetal").checkValidity()
    );
    expect(metalValid).toBe(false);
  });

  test("3. JS validator rejects empty Metal/Type even when HTML5 is bypassed", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    await page.fill("#itemName", "STAK580-RAW-CHECK");
    await page.fill("#itemWeight", "1");

    // Simulate a programmatic submit that skips native validation:
    // call validateItemFields directly on a parsed-fields shape with empty raw values.
    const error = await page.evaluate(() => {
      if (typeof window.validateItemFields !== "function") return "FN_NOT_EXPOSED";
      const fields = {
        _rawMetal: "",
        _rawType: "",
        _isEditing: false,
        name: "X",
        type: "Coin",
        metal: "Alloy", // would otherwise pass !f.metal due to parseNumistaMetal coercion
        weight: 1,
        qty: 1,
      };
      return window.validateItemFields(fields);
    });

    expect(error).not.toBe("FN_NOT_EXPOSED");
    expect(error).not.toBeNull();
    expect(error).toMatch(/select.*Metal.*Type/i);
  });

  test("4. Closing and reopening the modal resets Metal/Type to placeholder", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Bar");
    await expect(page.locator("#itemMetal")).toHaveValue("Gold");
    await expect(page.locator("#itemType")).toHaveValue("Bar");

    await closeModal(page);
    await openAddModal(page);

    await expect(page.locator("#itemMetal")).toHaveValue("");
    await expect(page.locator("#itemType")).toHaveValue("");
  });

  test("5. Editing an existing item pre-selects its Metal/Type (placeholder does not engage)", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.editItem(0));
    await expect(page.locator("#itemModal")).toBeVisible();

    await expect(page.locator("#itemMetal")).toHaveValue("Silver");
    await expect(page.locator("#itemType")).toHaveValue("Coin");
  });

  test("6. filterTypesByMetal preserves the Type placeholder's disabled state", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    // Picking a Metal must NOT auto-select Coin or any other Type — the placeholder
    // must remain selected and the Type select must remain invalid.
    await page.selectOption("#itemMetal", "Gold");
    await expect(page.locator("#itemType")).toHaveValue("");

    const placeholderState = await page.evaluate(() => {
      const select = document.getElementById("itemType");
      const placeholder = Array.from(select.options).find((opt) => opt.value === "");
      return {
        exists: Boolean(placeholder),
        disabled: placeholder?.disabled ?? null,
      };
    });
    expect(placeholderState.exists).toBe(true);
    expect(placeholderState.disabled).toBe(true);
  });
});

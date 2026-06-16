import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";
import { installStakTrakrNetworkMocks } from "../helpers/mocks/routes.js";

// ─── Shared helpers ──────────────────────────────────────────────────────────

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

function suppressWhatsNewPopup(page) {
  return page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") {
          localStorage.setItem("ackVersion", APP_VERSION);
        }
      },
      { once: true }
    );
  });
}

// ─── STRK-97 pilot: required metal/type, edit preselect ─────────────────────

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

// ─── Seed guard — boot state classification (from seed-guard.spec.js) ───────

test.describe("seed-guard", () => {
  const GUARD_BASE_ITEM = {
    uuid: "strk13-base-item",
    metal: "Silver",
    composition: "Silver",
    name: "STRK-13 Base Silver Eagle",
    qty: 4,
    type: "Coin",
    weight: 1,
    weightUnit: "oz",
    price: 100,
    marketValue: 0,
    date: "2026-04-01",
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
    spotPriceAtPurchase: 30,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.999,
    numistaId: "",
    serial: 1,
  };

  async function clearAppStorage(page) {
    await page.addInitScript(() => {
      localStorage.clear();
      indexedDB.deleteDatabase("StakTrakrImages");
    });
  }

  async function gotoApp(page) {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Array.isArray(window.inventory));
    await page.waitForLoadState("networkidle");
  }

  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
  });

  test("first-run-seeds: empty localStorage seeds 8 sample items and sets sentinel", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await gotoApp(page);

    const inventoryLength = await page.evaluate(() => window.inventory && window.inventory.length);
    expect(inventoryLength).toBe(8);

    const sentinel = await page.evaluate(() => localStorage.getItem("inventorySeedApplied"));
    expect(sentinel).not.toBeNull();

    const banner = page.locator("#inventoryRecoveryBanner");
    await expect(banner).toHaveCount(0);
  });

  test("returning-with-data-no-seed: pre-set inventory with sentinel does not merge sample data", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await page.addInitScript((item) => {
      localStorage.setItem("metalInventory", JSON.stringify([item]));
      localStorage.setItem("inventorySeedApplied", "2026-04-01T00:00:00.000Z");
    }, GUARD_BASE_ITEM);

    await gotoApp(page);

    const inventoryLength = await page.evaluate(() => window.inventory && window.inventory.length);
    expect(inventoryLength).toBe(1);

    const firstName = await page.evaluate(() => window.inventory[0] && window.inventory[0].name);
    expect(firstName).toBe(GUARD_BASE_ITEM.name);

    const sentinel = await page.evaluate(() => localStorage.getItem("inventorySeedApplied"));
    expect(sentinel).toBe("2026-04-01T00:00:00.000Z");
  });

  test("damaged-key-shows-banner: missing inventory + present serial shows recovery banner", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await page.addInitScript(() => {
      localStorage.setItem("inventorySerial", "5");
      localStorage.setItem("cloud_sync_local_modified", "2026-04-20T00:00:00.000Z");
    });

    await gotoApp(page);

    const banner = page.locator("#inventoryRecoveryBanner");
    await expect(banner).toBeVisible();

    const metalInventoryRaw = await page.evaluate(() => localStorage.getItem("metalInventory"));
    expect(metalInventoryRaw).toBeNull();

    const inventoryLength = await page.evaluate(() => window.inventory && window.inventory.length);
    expect(inventoryLength).toBe(0);

    const tableRows = await page.locator("#inventoryTable tbody tr").count();
    expect(tableRows).toBe(0);
  });

  test("parse-error-shows-banner: corrupt JSON shows recovery banner, records SyntaxError", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await page.addInitScript(() => {
      localStorage.setItem("metalInventory", "{not valid json");
    });

    await gotoApp(page);

    const banner = page.locator("#inventoryRecoveryBanner");
    await expect(banner).toBeVisible();

    const metalInventoryRaw = await page.evaluate(() => localStorage.getItem("metalInventory"));
    expect(metalInventoryRaw).toBe("{not valid json");

    const diagnosticsRaw = await page.evaluate(() =>
      localStorage.getItem("staktrakr.bootDiagnostics")
    );
    expect(diagnosticsRaw).not.toBeNull();
    const diagnostics = JSON.parse(diagnosticsRaw);
    expect(Array.isArray(diagnostics)).toBe(true);
    const hasSyntaxError = diagnostics.some((entry) => entry && entry.errorName === "SyntaxError");
    expect(hasSyntaxError).toBe(true);
  });

  test("migration-sets-sentinel: returning user without sentinel gets sentinel set without seeding", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await page.addInitScript((item) => {
      localStorage.setItem("metalInventory", JSON.stringify([item]));
    }, GUARD_BASE_ITEM);

    await gotoApp(page);

    const inventoryLength = await page.evaluate(() => window.inventory && window.inventory.length);
    expect(inventoryLength).toBe(1);

    const firstName = await page.evaluate(() => window.inventory[0] && window.inventory[0].name);
    expect(firstName).toBe(GUARD_BASE_ITEM.name);

    const sentinel = await page.evaluate(() => localStorage.getItem("inventorySeedApplied"));
    expect(sentinel).not.toBeNull();
  });

  test("compressed-inventory-loads: CMP1-prefixed inventory is not misclassified as parse-error", async ({
    page,
  }) => {
    await suppressWhatsNewPopup(page);
    await page.addInitScript((item) => {
      const items = [];
      for (let i = 0; i < 60; i++) {
        items.push(Object.assign({}, item, { uuid: `cmp-test-${i}`, serial: i + 1 }));
      }
      const json = JSON.stringify(items);
      if (json.length < 4096) {
        throw new Error("test fixture too small to trigger compression wrapper");
      }
      localStorage.setItem("metalInventory", "CMP1:" + json);
      localStorage.setItem("inventorySerial", String(items.length));
      localStorage.setItem("inventorySeedApplied", "2026-04-01T00:00:00.000Z");
    }, GUARD_BASE_ITEM);

    await gotoApp(page);

    const banner = page.locator("#inventoryRecoveryBanner");
    await expect(banner).toHaveCount(0);

    const inventoryLength = await page.evaluate(() => window.inventory && window.inventory.length);
    expect(inventoryLength).toBe(60);
  });
});

// ─── Capsule fields (from capsule-field.spec.js) ────────────────────────────

test.describe("capsule-field", () => {
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

  function catalogDetail(page, label) {
    return page
      .locator(".view-numista-section .view-detail-item")
      .filter({
        has: page.locator(".view-detail-label", { hasText: new RegExp(`^${label}$`) }),
      })
      .first();
  }

  test("saves capsule fields and updates suggestion/autocomplete from diameter", async ({
    page,
  }) => {
    await seedInventory(page);
    await gotoApp(page);
    await page.evaluate(() => document.getElementById("newItemBtn").click());
    await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });

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

    const restored = await page.evaluate(
      (uuid) => window.inventory.find((item) => item.uuid === uuid),
      CAPSULE_ITEM.uuid
    );
    expect(restored.capsule).toBe("X-38-Ring");
    expect(restored.capsuleNotes).toBe("Guardhouse 38mm - tight fit");
  });
});

// ─── Payment method (from payment-method.spec.js) ───────────────────────────

test.describe("payment-method", () => {
  const makeItem = (overrides = {}) => ({
    uuid: overrides.uuid || `strk-50-${overrides.serial || 1}`,
    metal: "Silver",
    composition: "Silver",
    name: overrides.name || "STRK-50 Test Eagle",
    qty: 1,
    type: "Coin",
    weight: 1,
    weightUnit: "oz",
    price: 30,
    marketValue: 35,
    date: "2026-05-13",
    purchaseLocation: "Local coin shop",
    storageLocation: "Safe",
    serialNumber: "",
    notes: "",
    year: "2026",
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
    serial: overrides.serial || 1,
    ...overrides,
  });

  async function seedData(page, inventory = []) {
    await page.addInitScript(
      ({ inv }) => {
        localStorage.setItem("metalInventory", JSON.stringify(inv));
        localStorage.setItem("inventorySerial", String(inv.length + 10));
        localStorage.setItem("inventorySeedApplied", "2026-05-13T00:00:00.000Z");
        localStorage.setItem("itemTags", JSON.stringify({}));
        localStorage.setItem("cardViewStyle", "A");
        localStorage.setItem("chipMinCount", "3");
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
        typeof window.duplicateItem === "function" &&
        typeof window.openBulkEdit === "function" &&
        typeof window.exportInventoryCSV === "function" &&
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

  async function submitItemModal(page) {
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).toBeHidden();
  }

  test("dropdown options persist and blank selection omits the key", async ({ page }) => {
    await seedData(page, [makeItem({ serial: 1, name: "STRK-50 Existing" })]);
    await gotoApp(page);
    await dismissWhatsNew(page);
    await page.evaluate(() => document.getElementById("newItemBtn").click());
    await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });

    const optionLabels = await page.locator("#itemPaymentMethod option").allTextContents();
    expect(optionLabels).toEqual([
      "(blank)",
      "Zelle",
      "PayPal",
      "Credit Card",
      "Debit Card",
      "Cash",
      "Check",
      "Wire",
      "Crypto",
      "Other",
    ]);

    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "STRK-50 Credit Purchase");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "31");
    await page.selectOption("#itemPaymentMethod", "Credit Card");
    await submitItemModal(page);

    let stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("metalInventory")).find(
        (item) => item.name === "STRK-50 Credit Purchase"
      )
    );
    expect(stored.paymentMethod).toBe("Credit Card");

    const idx = await page.evaluate(() =>
      window.inventory.findIndex((item) => item.name === "STRK-50 Credit Purchase")
    );
    await page.evaluate((inventoryIndex) => window.editItem(inventoryIndex), idx);
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemPaymentMethod")).toHaveValue("Credit Card");
    await page.selectOption("#itemPaymentMethod", "");
    await submitItemModal(page);

    stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("metalInventory")).find(
        (item) => item.name === "STRK-50 Credit Purchase"
      )
    );
    expect(Object.prototype.hasOwnProperty.call(stored, "paymentMethod")).toBe(false);
  });

  test("payment method participates in chips, search, and view modal", async ({ page }) => {
    await seedData(page, [
      makeItem({ serial: 1, name: "STRK-50 Card 1", paymentMethod: "Credit Card" }),
      makeItem({ serial: 2, name: "STRK-50 Card 2", paymentMethod: "Credit Card" }),
      makeItem({ serial: 3, name: "STRK-50 Card 3", paymentMethod: "Credit Card" }),
      makeItem({ serial: 4, name: "STRK-50 Zelle", paymentMethod: "Zelle" }),
    ]);
    await gotoApp(page);
    await page.evaluate(() => window.clearAllFilters());
    await expect(page.locator("#activeFilters .filter-chip-active")).toHaveCount(0);

    const creditChip = page
      .locator("#activeFilters .filter-chip")
      .filter({ hasText: "Credit Card" })
      .first();
    await expect(creditChip).toBeVisible();
    await creditChip.click();
    await expect(page.locator("#cardViewGrid")).toContainText("STRK-50 Card 1");
    await expect(page.locator("#cardViewGrid")).not.toContainText("STRK-50 Zelle");

    await page.evaluate(() => window.clearAllFilters());
    await page.fill("#searchInput", "Zelle");
    await expect(page.locator("#cardViewGrid")).toContainText("STRK-50 Zelle");
    await expect(page.locator("#cardViewGrid")).not.toContainText("STRK-50 Card 1");

    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator("#viewItemModal")).toBeVisible();
    await expect(page.locator("#viewItemModal")).toContainText("Payment Method");
    await expect(page.locator("#viewItemModal")).toContainText("Credit Card");
  });

  test("bulk edit sets and clears paymentMethod; clone preserves it", async ({ page }) => {
    await seedData(page, [
      makeItem({ serial: 1, name: "STRK-50 Bulk 1", paymentMethod: "PayPal" }),
      makeItem({ serial: 2, name: "STRK-50 Bulk 2" }),
    ]);
    await gotoApp(page);

    await dismissWhatsNew(page);
    await page.evaluate(() => window.openBulkEdit());
    await expect(page.locator("#bulkEditModal")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Select All" }).click();
    await page.click("#bulkField_paymentMethod");
    await page.selectOption("#bulkFieldVal_paymentMethod", "Wire");
    await page.getByRole("button", { name: /Apply Changes/ }).click();
    await page.click("#bulkConfirmOkBtn");
    await expect(page.locator("#bulkConfirmModal")).toBeHidden();

    let stored = await page.evaluate(() => JSON.parse(localStorage.getItem("metalInventory")));
    expect(stored.every((item) => item.paymentMethod === "Wire")).toBe(true);

    await page.selectOption("#bulkFieldVal_paymentMethod", "");
    await page.getByRole("button", { name: /Apply Changes/ }).click();
    await page.click("#bulkConfirmOkBtn");
    await expect(page.locator("#bulkConfirmModal")).toBeHidden();
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem("metalInventory")));
    expect(
      stored.every((item) => !Object.prototype.hasOwnProperty.call(item, "paymentMethod"))
    ).toBe(true);

    await page.evaluate(() => {
      window.inventory[0].paymentMethod = "PayPal";
      localStorage.setItem("metalInventory", JSON.stringify(window.inventory));
      window.duplicateItem(0);
    });
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemPaymentMethod")).toHaveValue("PayPal");
  });

  test("CSV/JSON export and JSON import round-trip paymentMethod", async ({ page }) => {
    await seedData(page, [
      makeItem({ serial: 1, name: "STRK-50 Export", paymentMethod: "Crypto" }),
    ]);
    await gotoApp(page);

    const csv = await page.evaluate(() => window.exportInventoryCSV());
    expect(csv).toContain("Payment Method");
    expect(csv).toContain("Crypto");

    const jsonText = await page.evaluate(() => {
      const captured = [];
      const OriginalBlob = window.Blob;
      window.Blob = function (parts, options) {
        captured.push(parts.join(""));
        return new OriginalBlob(parts, options);
      };
      const originalCreate = URL.createObjectURL;
      const originalClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = () => "blob:staktrakr-test";
      HTMLAnchorElement.prototype.click = () => {};
      window.exportJson();
      window.Blob = OriginalBlob;
      URL.createObjectURL = originalCreate;
      HTMLAnchorElement.prototype.click = originalClick;
      return captured[0];
    });
    expect(JSON.parse(jsonText).items[0].paymentMethod).toBe("Crypto");

    await page.evaluate(() => {
      window.importJsonFromText(
        JSON.stringify({
          items: [
            {
              metal: "Silver",
              composition: "Silver",
              name: "STRK-50 Imported",
              qty: 1,
              type: "Coin",
              weight: 1,
              price: 25,
              date: "2026-05-13",
              paymentMethod: "Wire",
              serial: 90,
              uuid: "strk-50-imported",
            },
          ],
        }),
        true
      );
    });
    await page.waitForFunction(() => {
      const stored = JSON.parse(localStorage.getItem("metalInventory") || "[]");
      return stored.length === 1 && stored[0].paymentMethod === "Wire";
    });
  });

  // ── STRK-170 characterization: pin editItem() field-population mapping ───────
  // Behavior-preserving guard for the editItem complexity refactor (cohort 1.1).
  // It pins the surfaces the helper extraction most risks: the weight-unit branch
  // chain (gb/kg/lb/g/oz + the sub-ounce→grams fallthrough), the FX/precision
  // price display, the metadata field→input mapping, purity preset/custom
  // selection, the storageLocation "Unknown" sentinel→blank, and the date-N/A
  // toggle. MUST pass on current code BEFORE the refactor and stay green after —
  // it goes red only if the refactor changes observable behavior.
  test("STRK-170: editItem populates form fields from item (characterization)", async ({
    page,
  }) => {
    await seedData(page, [
      // 0 — kitchen-sink oz item: full metadata + preset purity + present date
      makeItem({
        serial: 1,
        uuid: "strk170-oz",
        name: "STRK-170 Oz Eagle",
        metal: "Silver",
        composition: "Silver",
        type: "Coin",
        qty: 3,
        weight: 1,
        weightUnit: "oz",
        price: 30,
        marketValue: 35,
        purity: 0.999,
        paymentMethod: "Zelle",
        purchaseLocation: "Local coin shop",
        storageLocation: "Safe",
        serialNumber: "SN-123",
        notes: "char-test notes",
        capsule: "A-32",
        capsuleNotes: "snug",
        date: "2026-05-13",
        year: "2026",
        grade: "MS-70",
        gradingAuthority: "PCGS",
        certNumber: "C-987",
        pcgsNumber: "786060",
        numistaId: "12345",
        obverseImageUrl: "https://example.com/obv.png",
        reverseImageUrl: "https://example.com/rev.png",
        ignorePatternImages: true,
      }),
      // 1 — sub-ounce oz item: weight < 1 routes to the grams branch
      makeItem({
        serial: 2,
        uuid: "strk170-sub",
        name: "Sub-ounce",
        weight: 0.5,
        weightUnit: "oz",
      }),
      // 2 — kg item
      makeItem({
        serial: 3,
        uuid: "strk170-kg",
        name: "Kg bar",
        weight: 32.1507466,
        weightUnit: "kg",
      }),
      // 3 — lb item
      makeItem({
        serial: 4,
        uuid: "strk170-lb",
        name: "Lb bar",
        weight: 14.5833,
        weightUnit: "lb",
      }),
      // 4 — goldback (gb) item
      makeItem({
        serial: 5,
        uuid: "strk170-gb",
        name: "Goldback",
        metal: "Gold",
        composition: "Gold",
        weight: 1,
        weightUnit: "gb",
      }),
      // 5 — custom (non-preset) purity
      makeItem({ serial: 6, uuid: "strk170-custom", name: "Custom purity", purity: 0.835 }),
      // 6 — storageLocation "Unknown" sentinel → blank field
      makeItem({
        serial: 7,
        uuid: "strk170-unknown",
        name: "Unknown storage",
        storageLocation: "Unknown",
      }),
      // 7 — no purchase date → date N/A toggle active + date input disabled
      makeItem({ serial: 8, uuid: "strk170-nodate", name: "No date", date: "" }),
    ]);
    await gotoApp(page);
    await dismissWhatsNew(page);

    const openEdit = async (idx) => {
      await page.evaluate((i) => window.editItem(i), idx);
      await expect(page.locator("#itemModal")).toBeVisible();
    };

    // ── 0: kitchen-sink field mapping ──
    await openEdit(0);
    await expect(page.locator("#itemMetal")).toHaveValue("Silver");
    await expect(page.locator("#itemName")).toHaveValue("STRK-170 Oz Eagle");
    await expect(page.locator("#itemQty")).toHaveValue("3");
    await expect(page.locator("#itemType")).toHaveValue("Coin");
    await expect(page.locator("#itemWeightUnit")).toHaveValue("oz");
    await expect(page.locator("#itemWeight")).toHaveValue("1.00");
    await expect(page.locator("#itemPrice")).toHaveValue("30.00");
    await expect(page.locator("#itemMarketValue")).toHaveValue("35.00");
    await expect(page.locator("#itemPaymentMethod")).toHaveValue("Zelle");
    await expect(page.locator("#purchaseLocation")).toHaveValue("Local coin shop");
    await expect(page.locator("#storageLocation")).toHaveValue("Safe");
    await expect(page.locator("#itemSerialNumber")).toHaveValue("SN-123");
    await expect(page.locator("#itemNotes")).toHaveValue("char-test notes");
    await expect(page.locator("#itemCapsule")).toHaveValue("A-32");
    await expect(page.locator("#itemCapsuleNotes")).toHaveValue("snug");
    await expect(page.locator("#itemDate")).toHaveValue("2026-05-13");
    await expect(page.locator("#itemYear")).toHaveValue("2026");
    await expect(page.locator("#itemGrade")).toHaveValue("MS-70");
    await expect(page.locator("#itemGradingAuthority")).toHaveValue("PCGS");
    await expect(page.locator("#itemCertNumber")).toHaveValue("C-987");
    await expect(page.locator("#itemPcgsNumber")).toHaveValue("786060");
    await expect(page.locator("#itemCatalog")).toHaveValue("12345");
    await expect(page.locator("#itemObverseImageUrl")).toHaveValue("https://example.com/obv.png");
    await expect(page.locator("#itemReverseImageUrl")).toHaveValue("https://example.com/rev.png");
    await expect(page.locator("#itemIgnorePatternImages")).toBeChecked();
    // preset purity → select set, custom wrapper hidden, custom input cleared
    await expect(page.locator("#itemPuritySelect")).toHaveValue("0.999");
    await expect(page.locator("#purityCustomWrapper")).toBeHidden();
    await expect(page.locator("#itemPurity")).toHaveValue("");
    // present date → N/A toggle inactive, date input enabled
    await expect(page.locator("#itemDateNABtn")).not.toHaveClass(/\bactive\b/);
    await expect(page.locator("#itemDate")).toBeEnabled();

    // ── 1: sub-ounce oz weight routes to the grams branch ──
    await openEdit(1);
    await expect(page.locator("#itemWeightUnit")).toHaveValue("g");

    // ── 2: kg branch ──
    await openEdit(2);
    await expect(page.locator("#itemWeightUnit")).toHaveValue("kg");

    // ── 3: lb branch ──
    await openEdit(3);
    await expect(page.locator("#itemWeightUnit")).toHaveValue("lb");

    // ── 4: goldback branch ──
    await openEdit(4);
    await expect(page.locator("#itemWeightUnit")).toHaveValue("gb");
    await expect(page.locator("#itemWeight")).toHaveValue("1");

    // ── 5: custom (non-preset) purity → select=custom, wrapper shown, input set ──
    await openEdit(5);
    await expect(page.locator("#itemPuritySelect")).toHaveValue("custom");
    await expect(page.locator("#purityCustomWrapper")).toBeVisible();
    await expect(page.locator("#itemPurity")).toHaveValue("0.835");

    // ── 6: storageLocation "Unknown" sentinel → blank field ──
    await openEdit(6);
    await expect(page.locator("#storageLocation")).toHaveValue("");

    // ── 7: no date → N/A toggle active + date input disabled ──
    await openEdit(7);
    await expect(page.locator("#itemDateNABtn")).toHaveClass(/\bactive\b/);
    await expect(page.locator("#itemDate")).toBeDisabled();
  });
});

// ─── Virtual sort options (from virtual-sort-options.spec.js) ────────────────

test.describe("virtual-sort-options", () => {
  const SORT_BASE_ITEM = {
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

  test("adds Storage and Year to both sort dropdowns as virtual values", async ({ page }) => {
    await seedInventory(page, [{ ...SORT_BASE_ITEM, uuid: "strk-47-one" }]);
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
      {
        ...SORT_BASE_ITEM,
        uuid: "strk-47-vault-c",
        name: "Storage C",
        storageLocation: "Vault C",
      },
      {
        ...SORT_BASE_ITEM,
        uuid: "strk-47-vault-a",
        name: "Storage A",
        storageLocation: "Vault A",
      },
      {
        ...SORT_BASE_ITEM,
        uuid: "strk-47-vault-b",
        name: "Storage B",
        storageLocation: "Vault B",
      },
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
      { ...SORT_BASE_ITEM, uuid: "strk-47-year-missing", name: "Year Missing", year: "" },
      { ...SORT_BASE_ITEM, uuid: "strk-47-year-2020", name: "Year 2020", year: "2020" },
      { ...SORT_BASE_ITEM, uuid: "strk-47-year-2025", name: "Year 2025", year: "2025" },
      { ...SORT_BASE_ITEM, uuid: "strk-47-year-unknown", name: "Year Unknown", year: "Unknown" },
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

// ─── CRUD journey — serial (from crud.spec.js) ──────────────────────────────

// This block uses test.describe.serial with a shared page because the CRUD
// tests build on prior state (add, then edit, then delete). The shared page is
// created via browser.newPage(), so extended-test's auto-mocking does not apply
// — we install mocks manually.

async function countCards(page) {
  return page.locator("#cardViewGrid article").count();
}

async function openAddModalCrud(page) {
  const whatsNew = page.locator("#whatsNewPopup");
  if (await whatsNew.isVisible()) {
    await page.click("#whatsNewDismissBtn");
  }
  await page.evaluate(() => document.getElementById("newItemBtn").click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

async function submitItemForm(page) {
  await page.click("#itemModalSubmit");
  await expect(page.locator("#itemModal")).toBeHidden();
}

async function deleteItemByName(page, name) {
  const row = page.locator("#inventoryTable tbody tr").filter({ hasText: name });
  await row
    .locator(
      'button[title*="elete"], button[aria-label*="elete"], button.delete-btn, td.actions button'
    )
    .first()
    .click();
  const dialog = page
    .locator('.modal:visible, [role="dialog"]:visible')
    .filter({ hasText: /confirm|delete|remove/i });
  if ((await dialog.count()) > 0) {
    await dialog
      .locator("button")
      .filter({ hasText: /confirm|yes|delete|ok/i })
      .first()
      .click();
  }
}

let sharedPage;

test.describe.serial("crud-journey", () => {
  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    await installStakTrakrNetworkMocks(sharedPage);
    await injectSeedInventory(sharedPage);
    await sharedPage.addInitScript(() => {
      localStorage.setItem("cardViewStyle", "A");
    });
    await sharedPage.goto("/index.html", { waitUntil: "domcontentloaded" });
    await sharedPage.waitForSelector("#newItemBtn", { state: "visible" });
    await sharedPage.waitForSelector("#cardViewGrid article", {
      state: "attached",
      timeout: 15000,
    });
    await sharedPage.waitForTimeout(500);
    const popup = sharedPage.locator("#whatsNewPopup");
    if (await popup.isVisible()) {
      await sharedPage.click("#whatsNewDismissBtn");
    }
  });

  test.afterAll(async () => {
    if (!sharedPage) return;
    await sharedPage.click('[data-style="D"]');
    await sharedPage.waitForSelector("#inventoryTable tbody tr", { state: "visible" });

    const bbNames = [
      "BB-SILVER-COIN",
      "BB-GOLD-BAR",
      "BB-GOLD-BAR-EDITED",
      "BB-PLAT-ROUND",
      "BB-PALL-BAR",
      "BB-GOLDBACK",
      "BB-OZ-ITEM",
      "BB-G-ITEM",
      "BB-KG-ITEM",
      "BB-DWT-ITEM",
      "BB-COUNT-TEST",
    ];

    for (const name of bbNames) {
      const row = sharedPage.locator("#inventoryTable tbody tr").filter({ hasText: name });
      if ((await row.count()) > 0) {
        await deleteItemByName(sharedPage, name);
        await expect(row).toBeHidden();
      }
    }
    await sharedPage.close();
  });

  test("add item — Silver Coin", async () => {
    const page = sharedPage;
    await openAddModalCrud(page);
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "BB-SILVER-COIN");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "25");
    await submitItemForm(page);
    expect(await countCards(page)).toBe(9);
    await expect(page.locator("#cardViewGrid")).toContainText("BB-SILVER-COIN");
  });

  test("add item — Gold Bar", async () => {
    const page = sharedPage;
    await openAddModalCrud(page);
    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Bar");
    await page.fill("#itemName", "BB-GOLD-BAR");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "2000");
    await submitItemForm(page);
    expect(await countCards(page)).toBe(10);
    await expect(page.locator("#cardViewGrid")).toContainText("BB-GOLD-BAR");
  });

  test("add item — Platinum Round", async () => {
    const page = sharedPage;
    await openAddModalCrud(page);
    await page.selectOption("#itemMetal", "Platinum");
    await page.selectOption("#itemType", "Round");
    await page.fill("#itemName", "BB-PLAT-ROUND");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "1000");
    await submitItemForm(page);
    expect(await countCards(page)).toBe(11);
    await expect(page.locator("#cardViewGrid")).toContainText("BB-PLAT-ROUND");
  });

  test("add item — Palladium Bar", async () => {
    const page = sharedPage;
    await openAddModalCrud(page);
    await page.selectOption("#itemMetal", "Palladium");
    await page.selectOption("#itemType", "Bar");
    await page.fill("#itemName", "BB-PALL-BAR");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "1000");
    await submitItemForm(page);
    expect(await countCards(page)).toBe(12);
    await expect(page.locator("#cardViewGrid")).toContainText("BB-PALL-BAR");
  });

  test("add item — Goldback", async () => {
    const page = sharedPage;
    await openAddModalCrud(page);
    await page.selectOption("#itemMetal", "Gold");
    await page.selectOption("#itemType", "Goldback");
    await page.fill("#itemName", "BB-GOLDBACK");
    await page.fill("#itemPrice", "5");
    await submitItemForm(page);
    expect(await countCards(page)).toBe(13);
    await expect(page.locator("#cardViewGrid")).toContainText("BB-GOLDBACK");
  });

  test("add items with each weight unit (oz, g, kg, lb)", async () => {
    const page = sharedPage;

    await openAddModalCrud(page);
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "BB-OZ-ITEM");
    await page.selectOption("#itemWeightUnit", "oz");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "25");
    await submitItemForm(page);

    await openAddModalCrud(page);
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "BB-G-ITEM");
    await page.selectOption("#itemWeightUnit", "g");
    await page.fill("#itemWeight", "31.1");
    await page.fill("#itemPrice", "25");
    await submitItemForm(page);

    await openAddModalCrud(page);
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "BB-KG-ITEM");
    await page.selectOption("#itemWeightUnit", "kg");
    await page.fill("#itemWeight", "0.0311");
    await page.fill("#itemPrice", "25");
    await submitItemForm(page);

    await openAddModalCrud(page);
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "BB-DWT-ITEM");
    await page.selectOption("#itemWeightUnit", "lb");
    await page.fill("#itemWeight", "20");
    await page.fill("#itemPrice", "25");
    await submitItemForm(page);

    expect(await countCards(page)).toBe(17);
    await expect(page.locator("#cardViewGrid")).toContainText("BB-OZ-ITEM");
    await expect(page.locator("#cardViewGrid")).toContainText("BB-G-ITEM");
    await expect(page.locator("#cardViewGrid")).toContainText("BB-KG-ITEM");
    await expect(page.locator("#cardViewGrid")).toContainText("BB-DWT-ITEM");
  });

  test("upload obverse image", async () => {
    const page = sharedPage;
    const idx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.name === "BB-SILVER-COIN")
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    await page.evaluate((i) => window.editItem(i), idx);
    await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });

    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    await page.setInputFiles("#itemImageFileObv", {
      name: "test-obv.png",
      mimeType: "image/png",
      buffer: pngBuffer,
    });
    await expect(page.locator("#itemImagePreviewObv")).toBeVisible({ timeout: 10000 });
    await submitItemForm(page);
  });

  test("upload reverse image", async () => {
    const page = sharedPage;
    const idx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.name === "BB-SILVER-COIN")
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    await page.evaluate((i) => window.editItem(i), idx);
    await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });

    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    await page.setInputFiles("#itemImageFileRev", {
      name: "test-rev.png",
      mimeType: "image/png",
      buffer: pngBuffer,
    });
    await expect(page.locator("#itemImagePreviewRev")).toBeVisible({ timeout: 10000 });
    await submitItemForm(page);
  });

  test("remove an uploaded image", async () => {
    const page = sharedPage;
    const idx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.name === "BB-SILVER-COIN")
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    await page.evaluate((i) => window.editItem(i), idx);
    await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });

    const removeBtn = page.locator("#itemImageRemoveBtnObv");
    if (await removeBtn.isVisible()) {
      await removeBtn.click();
      await expect(page.locator("#itemImagePreviewObv")).toBeHidden();
    }
    await submitItemForm(page);
  });

  test("apply pattern-matched image (seed image rule)", async () => {
    const page = sharedPage;
    const hasGetCustomRules = await page.evaluate(
      () => typeof window.NumistaLookup?.getCustomRules === "function"
    );
    expect(hasGetCustomRules).toBe(true);

    const hasImageCache = await page.evaluate(
      () => typeof window.imageCache?.isAvailable === "function"
    );
    expect(hasImageCache).toBe(true);
  });

  test("remove pattern-matched image", async () => {
    const page = sharedPage;
    const hasDeleteImages = await page.evaluate(
      () => typeof window.imageCache?.deleteImages === "function"
    );
    expect(hasDeleteImages).toBe(true);

    const hasDeleteMetadata = await page.evaluate(
      () => typeof window.imageCache?.deleteMetadata === "function"
    );
    expect(hasDeleteMetadata).toBe(true);
  });

  test("edit an existing item (all fields)", async () => {
    const page = sharedPage;
    const idx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.name === "BB-GOLD-BAR")
    );
    expect(idx).toBeGreaterThanOrEqual(0);

    await page.evaluate((i) => window.editItem(i), idx);
    await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#itemModalTitle")).toContainText("Edit");

    await page.fill("#itemName", "BB-GOLD-BAR-EDITED");
    await page.fill("#itemPrice", "2100");
    await submitItemForm(page);

    await expect(page.locator("#cardViewGrid")).toContainText("BB-GOLD-BAR-EDITED");
    expect(await countCards(page)).toBe(17);
  });

  test("delete item — confirmation dialog appears before delete", async () => {
    const page = sharedPage;
    const idx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.name === "BB-PALL-BAR")
    );
    expect(idx).toBeGreaterThanOrEqual(0);

    await page.evaluate((i) => window.deleteItem(i), idx);
    await expect(page.locator("#removeItemModal")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#removeItemName")).toContainText("BB-PALL-BAR");

    await page.click("#removeItemDeleteBtn");
    await expect(page.locator("#removeItemModal")).toBeHidden();
    expect(await countCards(page)).toBe(16);
  });

  test("item count badge updates after add/edit/delete", async () => {
    const page = sharedPage;

    const initialCount = await page.locator("#totalItemsAll").textContent();
    expect(parseInt(initialCount, 10)).toBe(16);

    await openAddModalCrud(page);
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "BB-COUNT-TEST");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "25");
    await submitItemForm(page);

    const afterAdd = await page.locator("#totalItemsAll").textContent();
    expect(parseInt(afterAdd, 10)).toBe(17);

    const idx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.name === "BB-COUNT-TEST")
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    await page.evaluate((i) => window.deleteItem(i), idx);
    await expect(page.locator("#removeItemModal")).toBeVisible({ timeout: 5000 });
    await page.click("#removeItemDeleteBtn");
    await expect(page.locator("#removeItemModal")).toBeHidden();

    const afterDelete = await page.locator("#totalItemsAll").textContent();
    expect(parseInt(afterDelete, 10)).toBe(16);
  });

  test("search for an item by name", async () => {
    const page = sharedPage;
    await page.fill("#searchInput", "BB-SILVER");

    await expect(page.locator("#cardViewGrid")).toContainText("BB-SILVER-COIN");
    const grid = page.locator("#cardViewGrid");
    await expect(grid).not.toContainText("BB-GOLD-BAR-EDITED");
  });

  test("filter chips reflect search results", async () => {
    const page = sharedPage;
    const chipContainer = page.locator("#activeFilters");
    await expect(chipContainer).toBeVisible();
    const chipCount = await chipContainer.locator(".filter-chip").count();
    expect(chipCount).toBeGreaterThan(0);

    await page.evaluate(() => window.clearAllFilters());
    await expect(page.locator("#activeFilters .filter-chip-active")).toHaveCount(0);
  });

  test("filter via chip (metal)", async () => {
    const page = sharedPage;
    await page.evaluate(() => window.clearAllFilters());
    await expect(page.locator("#activeFilters .filter-chip-active")).toHaveCount(0);

    const beforeCount = await countCards(page);
    expect(beforeCount).toBe(16);

    const silverChip = page.locator(".filter-chip").filter({ hasText: "Silver" }).first();
    await expect(silverChip).toBeVisible({ timeout: 5000 });
    await silverChip.click();
    await expect(page.locator("#cardViewGrid article")).not.toHaveCount(beforeCount);
    const afterCount = await countCards(page);
    expect(afterCount).toBeGreaterThan(0);
    expect(afterCount).toBeLessThan(beforeCount);
  });

  test("remove filter chip narrows/expands results", async () => {
    const page = sharedPage;
    const filteredCount = await countCards(page);
    expect(filteredCount).toBeLessThan(16);

    const activeChip = page
      .locator(".filter-chip.filter-chip-active")
      .filter({ hasText: "Silver" })
      .first();
    await activeChip.click();
    await expect(page.locator("#cardViewGrid article")).toHaveCount(16);

    const afterCount = await countCards(page);
    expect(afterCount).toBe(16);

    await page.evaluate(() => window.clearAllFilters());
    await expect(page.locator("#activeFilters .filter-chip-active")).toHaveCount(0);
  });

  test("switch card views A → B → C → Table (D)", async () => {
    const page = sharedPage;

    await page.click('[data-style="A"]');
    await expect(page.locator("#cardViewGrid article")).toHaveCount(16);

    await page.click('[data-style="B"]');
    await expect(page.locator("#cardViewGrid article")).toHaveCount(16);

    await page.click('[data-style="C"]');
    await expect(page.locator("#cardViewGrid article")).toHaveCount(16);

    await page.click('[data-style="D"]');
    await expect(page.locator("#inventoryTable")).toBeVisible();
    const tableRows = await page.locator("#inventoryTable tbody tr").count();
    expect(tableRows).toBeGreaterThan(0);

    await page.click('[data-style="A"]');
    await expect(page.locator("#cardViewGrid article")).toHaveCount(16);
  });

  test("melt value recalculates correctly when spot price changes", async () => {
    const page = sharedPage;
    const initialMelt = await page.evaluate(() => {
      const item = window.inventory.find((i) => i.name === "BB-SILVER-COIN");
      if (!item) return null;
      const spot = spotPrices.silver || 0;
      return typeof computeMeltValue === "function" ? computeMeltValue(item, spot) : null;
    });

    await page.evaluate(() => {
      spotPrices.silver = 50;
      if (typeof renderTable === "function") renderTable();
    });

    const updatedMelt = await page.evaluate(() => {
      const item = window.inventory.find((i) => i.name === "BB-SILVER-COIN");
      if (!item) return null;
      return typeof computeMeltValue === "function" ? computeMeltValue(item, 50) : null;
    });

    expect(updatedMelt).not.toBeNull();
    expect(updatedMelt).toBeGreaterThan(0);
    if (initialMelt !== null && initialMelt > 0) {
      expect(updatedMelt).not.toBe(initialMelt);
    }
  });

  test("cleanup — BB-* test items exist and deleteItem is callable", async () => {
    const page = sharedPage;
    const bbItems = await page.evaluate(() =>
      window.inventory.filter((i) => i.name && i.name.startsWith("BB-")).map((i) => i.name)
    );
    expect(bbItems.length).toBeGreaterThan(0);

    const hasDeleteItem = await page.evaluate(() => typeof window.deleteItem === "function");
    expect(hasDeleteItem).toBe(true);
  });
});

// ─── Filter chip AND logic (from filter-chip-and-logic.spec.js) ─────────────

const CHIP_FIXTURE_UUIDS = {
  A: "stak546-item-a-silver-allegory-cat",
  B: "stak546-item-b-silver-allegory",
  C: "stak546-item-c-silver-cat",
  D: "stak546-item-d-gold-allegory",
  E: "stak546-item-e-silver-allegory-damaged",
};

const CHIP_FIXTURE_INVENTORY = [
  {
    uuid: CHIP_FIXTURE_UUIDS.A,
    metal: "Silver",
    composition: "Silver",
    name: "STAK546 Silver Allegory Cat",
    qty: 1,
    type: "Coin",
    weight: 1,
    price: 40,
    marketValue: 0,
    date: "2025-01-01",
    purchaseLocation: "staktrakr.com",
    storageLocation: "",
    serialNumber: "",
    notes: "",
    year: "2025",
    grade: "",
    gradingAuthority: "",
    certNumber: "",
    pcgsNumber: "",
    pcgsVerified: false,
    spotPriceAtPurchase: 37,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.999,
    numistaId: "",
    serial: 101,
  },
  {
    uuid: CHIP_FIXTURE_UUIDS.B,
    metal: "Silver",
    composition: "Silver",
    name: "STAK546 Silver Allegory",
    qty: 1,
    type: "Coin",
    weight: 1,
    price: 41,
    marketValue: 0,
    date: "2025-01-02",
    purchaseLocation: "staktrakr.com",
    storageLocation: "",
    serialNumber: "",
    notes: "",
    year: "2025",
    grade: "",
    gradingAuthority: "",
    certNumber: "",
    pcgsNumber: "",
    pcgsVerified: false,
    spotPriceAtPurchase: 37,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.999,
    numistaId: "",
    serial: 102,
  },
  {
    uuid: CHIP_FIXTURE_UUIDS.C,
    metal: "Silver",
    composition: "Silver",
    name: "STAK546 Silver Cat",
    qty: 1,
    type: "Coin",
    weight: 1,
    price: 39,
    marketValue: 0,
    date: "2025-01-03",
    purchaseLocation: "staktrakr.com",
    storageLocation: "",
    serialNumber: "",
    notes: "",
    year: "2025",
    grade: "",
    gradingAuthority: "",
    certNumber: "",
    pcgsNumber: "",
    pcgsVerified: false,
    spotPriceAtPurchase: 37,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.999,
    numistaId: "",
    serial: 103,
  },
  {
    uuid: CHIP_FIXTURE_UUIDS.D,
    metal: "Gold",
    composition: "Gold",
    name: "STAK546 Gold Allegory",
    qty: 1,
    type: "Coin",
    weight: 1,
    price: 3400,
    marketValue: 0,
    date: "2025-01-04",
    purchaseLocation: "staktrakr.com",
    storageLocation: "",
    serialNumber: "",
    notes: "",
    year: "2025",
    grade: "",
    gradingAuthority: "",
    certNumber: "",
    pcgsNumber: "",
    pcgsVerified: false,
    spotPriceAtPurchase: 3333,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.9999,
    numistaId: "",
    serial: 104,
  },
  {
    uuid: CHIP_FIXTURE_UUIDS.E,
    metal: "Silver",
    composition: "Silver",
    name: "STAK546 Silver Allegory Damaged",
    qty: 1,
    type: "Coin",
    weight: 1,
    price: 38,
    marketValue: 0,
    date: "2025-01-05",
    purchaseLocation: "staktrakr.com",
    storageLocation: "",
    serialNumber: "",
    notes: "",
    year: "2025",
    grade: "",
    gradingAuthority: "",
    certNumber: "",
    pcgsNumber: "",
    pcgsVerified: false,
    spotPriceAtPurchase: 37,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.999,
    numistaId: "",
    serial: 105,
  },
];

const CHIP_FIXTURE_ITEM_TAGS = {
  [CHIP_FIXTURE_UUIDS.A]: ["Allegory", "Cat"],
  [CHIP_FIXTURE_UUIDS.B]: ["Allegory"],
  [CHIP_FIXTURE_UUIDS.C]: ["Cat"],
  [CHIP_FIXTURE_UUIDS.D]: ["Allegory"],
  [CHIP_FIXTURE_UUIDS.E]: ["Allegory", "Damaged"],
};

async function filteredUuids(page) {
  return page.evaluate(() => {
    const items = window.filterInventoryAdvanced();
    return items.map((item) => item.uuid);
  });
}

async function dataRowCount(page) {
  return page.locator("#inventoryTable tbody tr:not(.empty-state-row)").count();
}

async function clearChips(page) {
  await page.evaluate(() => {
    if (typeof window.clearAllFilters === "function") window.clearAllFilters();
  });
}

test.describe("filter-chip-and-logic — AND semantics", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ inv, tags }) => {
        localStorage.setItem("metalInventory", JSON.stringify(inv));
        localStorage.setItem("itemTags", JSON.stringify(tags));
      },
      { inv: CHIP_FIXTURE_INVENTORY, tags: CHIP_FIXTURE_ITEM_TAGS }
    );

    await page.addInitScript(() => {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") {
            localStorage.setItem("ackVersion", APP_VERSION);
          }
        },
        { once: true }
      );
    });

    await page.goto("/index.html");
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 5;
      } catch (e) {
        return false;
      }
    });
  });

  test.afterEach(async ({ page }) => {
    await clearChips(page);
  });

  test("Case 1 — single tags:Allegory chip renders exactly the Allegory items", async ({
    page,
  }) => {
    await page.evaluate(() => window.applyQuickFilter("tags", "Allegory"));

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(
      new Set([
        CHIP_FIXTURE_UUIDS.A,
        CHIP_FIXTURE_UUIDS.B,
        CHIP_FIXTURE_UUIDS.D,
        CHIP_FIXTURE_UUIDS.E,
      ])
    );
    expect(uuids).toHaveLength(4);
    expect(await dataRowCount(page)).toBe(4);
  });

  test("Case 2 — tags:Allegory + tags:Cat intersects to items carrying BOTH (AND)", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("tags", "Allegory");
      window.applyQuickFilter("tags", "Cat");
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(new Set([CHIP_FIXTURE_UUIDS.A]));
    expect(uuids).toHaveLength(1);
    expect(await dataRowCount(page)).toBe(1);
  });

  test("Case 3 — metal:Silver + tags:Cat intersects cross-field", async ({ page }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Silver");
      window.applyQuickFilter("tags", "Cat");
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(new Set([CHIP_FIXTURE_UUIDS.A, CHIP_FIXTURE_UUIDS.C]));
    expect(uuids).toHaveLength(2);
    expect(await dataRowCount(page)).toBe(2);
  });

  test("Case 4 — metal:Gold + metal:Silver returns all items (OR of scalar multi-select)", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Gold");
      window.applyQuickFilter("metal", "Silver");
    });
    expect(await dataRowCount(page)).toBe(5);
  });

  test("Case 5 — removing tags:Cat from case 2 returns the Allegory-only set", async ({ page }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("tags", "Allegory");
      window.applyQuickFilter("tags", "Cat");
      window.applyQuickFilter("tags", "Cat");
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(
      new Set([
        CHIP_FIXTURE_UUIDS.A,
        CHIP_FIXTURE_UUIDS.B,
        CHIP_FIXTURE_UUIDS.D,
        CHIP_FIXTURE_UUIDS.E,
      ])
    );
    expect(uuids).toHaveLength(4);
    expect(await dataRowCount(page)).toBe(4);
  });

  test("Case 6 — exclude-mode tags:Damaged keeps items without that tag", async ({ page }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("tags", "Damaged", false, true);
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(
      new Set([
        CHIP_FIXTURE_UUIDS.A,
        CHIP_FIXTURE_UUIDS.B,
        CHIP_FIXTURE_UUIDS.C,
        CHIP_FIXTURE_UUIDS.D,
      ])
    );
    expect(uuids).toHaveLength(4);
    expect(await dataRowCount(page)).toBe(4);
  });

  test("Case 7 — exclude-mode multi-tag removes items matching ANY excluded value", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("tags", "Damaged", false, true);
      window.applyQuickFilter("tags", "Rare", false, true);
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(
      new Set([
        CHIP_FIXTURE_UUIDS.A,
        CHIP_FIXTURE_UUIDS.B,
        CHIP_FIXTURE_UUIDS.C,
        CHIP_FIXTURE_UUIDS.D,
      ])
    );
    expect(uuids).toHaveLength(4);
    expect(await dataRowCount(page)).toBe(4);
  });

  test("Case 8 — metal:Silver + metal:Gold returns items of both metals (OR within field)", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Silver");
      window.applyQuickFilter("metal", "Gold");
    });

    const uuids = await filteredUuids(page);
    expect(uuids.length).toBeGreaterThan(0);
    const metals = await page.evaluate(() => {
      return window.filterInventoryAdvanced().map((item) => item.metal);
    });
    expect(metals).toContain("Silver");
    expect(metals).toContain("Gold");
  });

  test("Case 9 — tags AND is preserved: two tag chips intersect correctly", async ({ page }) => {
    const extraItems = [
      {
        uuid: "stak551-item-f-red-green",
        metal: "Silver",
        composition: "Silver",
        name: "STAK551 Red Green Item",
        qty: 1,
        type: "Coin",
        weight: 1,
        price: 30,
        marketValue: 0,
        date: "2025-02-01",
        purchaseLocation: "staktrakr.com",
        storageLocation: "",
        serialNumber: "",
        notes: "",
        year: "2025",
        grade: "",
        gradingAuthority: "",
        certNumber: "",
        pcgsNumber: "",
        pcgsVerified: false,
        spotPriceAtPurchase: 28,
        premiumPerOz: 0,
        totalPremium: 0,
        purity: 0.999,
        numistaId: "",
        serial: 201,
      },
      {
        uuid: "stak551-item-g-red-only",
        metal: "Silver",
        composition: "Silver",
        name: "STAK551 Red Only Item",
        qty: 1,
        type: "Coin",
        weight: 1,
        price: 30,
        marketValue: 0,
        date: "2025-02-02",
        purchaseLocation: "staktrakr.com",
        storageLocation: "",
        serialNumber: "",
        notes: "",
        year: "2025",
        grade: "",
        gradingAuthority: "",
        certNumber: "",
        pcgsNumber: "",
        pcgsVerified: false,
        spotPriceAtPurchase: 28,
        premiumPerOz: 0,
        totalPremium: 0,
        purity: 0.999,
        numistaId: "",
        serial: 202,
      },
    ];
    const extraTags = {
      "stak551-item-f-red-green": ["Red", "Green"],
      "stak551-item-g-red-only": ["Red"],
    };

    await page.addInitScript(
      ({ extras, eTags }) => {
        const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
        inv.push(...extras);
        localStorage.setItem("metalInventory", JSON.stringify(inv));
        const tags = JSON.parse(localStorage.getItem("itemTags") || "{}");
        Object.assign(tags, eTags);
        localStorage.setItem("itemTags", JSON.stringify(tags));
      },
      { extras: extraItems, eTags: extraTags }
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 7;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => {
      window.applyQuickFilter("tags", "Red");
      window.applyQuickFilter("tags", "Green");
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(new Set(["stak551-item-f-red-green"]));
    expect(uuids).toHaveLength(1);
  });

  test("Case 10 — customGroup + metal intersection returns matching items", async ({ page }) => {
    await page.evaluate(() => {
      const groups = [
        { id: "cg_test_allegory", label: "Allegories", patterns: ["Allegory"], enabled: true },
      ];
      localStorage.setItem("chipCustomGroups", JSON.stringify(groups));
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 5;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Gold");
      window.applyQuickFilter("customGroup", "cg_test_allegory");
    });

    const uuids = await filteredUuids(page);
    expect(uuids.length).toBeGreaterThan(0);
    expect(uuids).toContain(CHIP_FIXTURE_UUIDS.D);
  });

  test("Case 11 — groupedName + metal returns items matching grouped base name", async ({
    page,
  }) => {
    const aseItems = [
      {
        uuid: "stak551-ase-1999",
        metal: "Silver",
        composition: "Silver",
        name: "1999 American Silver Eagle",
        qty: 1,
        type: "Coin",
        weight: 1,
        price: 25,
        marketValue: 0,
        date: "2025-03-01",
        purchaseLocation: "tulsacoins.com",
        storageLocation: "",
        serialNumber: "",
        notes: "",
        year: "1999",
        grade: "",
        gradingAuthority: "",
        certNumber: "",
        pcgsNumber: "",
        pcgsVerified: false,
        spotPriceAtPurchase: 20,
        premiumPerOz: 0,
        totalPremium: 0,
        purity: 0.999,
        numistaId: "",
        serial: 301,
      },
      {
        uuid: "stak551-ase-2024",
        metal: "Silver",
        composition: "Silver",
        name: "2024 American Silver Eagle",
        qty: 1,
        type: "Coin",
        weight: 1,
        price: 35,
        marketValue: 0,
        date: "2025-03-02",
        purchaseLocation: "apmex.com",
        storageLocation: "",
        serialNumber: "",
        notes: "",
        year: "2024",
        grade: "",
        gradingAuthority: "",
        certNumber: "",
        pcgsNumber: "",
        pcgsVerified: false,
        spotPriceAtPurchase: 28,
        premiumPerOz: 0,
        totalPremium: 0,
        purity: 0.999,
        numistaId: "",
        serial: 302,
      },
    ];
    await page.addInitScript(
      ({ extras }) => {
        const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
        inv.push(...extras);
        localStorage.setItem("metalInventory", JSON.stringify(inv));
      },
      { extras: aseItems }
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 7;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Silver");
      window.applyQuickFilter("name", "American Silver Eagle", true);
    });

    const uuids = await filteredUuids(page);
    expect(uuids.length).toBeGreaterThan(0);
    expect(uuids).toContain("stak551-ase-1999");
    expect(uuids).toContain("stak551-ase-2024");
  });

  test("Case 12 — exclude customGroup hides items matching group patterns", async ({ page }) => {
    await page.evaluate(() => {
      const groups = [
        { id: "cg_test_allegory", label: "Allegories", patterns: ["Allegory"], enabled: true },
      ];
      localStorage.setItem("chipCustomGroups", JSON.stringify(groups));
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 5;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => {
      window.applyQuickFilter("customGroup", "cg_test_allegory", false, true);
    });

    const uuids = await filteredUuids(page);
    expect(uuids).not.toContain(CHIP_FIXTURE_UUIDS.A);
    expect(uuids).not.toContain(CHIP_FIXTURE_UUIDS.B);
    expect(uuids).not.toContain(CHIP_FIXTURE_UUIDS.D);
    expect(uuids).not.toContain(CHIP_FIXTURE_UUIDS.E);
    expect(uuids).toContain(CHIP_FIXTURE_UUIDS.C);
    expect(uuids).toHaveLength(1);
  });

  test("Case 13 — chipMinCount threshold is honored in rendered chip badges", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem("chipMinCount", "2");
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 5;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => window.applyQuickFilter("metal", "Silver"));

    await page.evaluate(() => {
      const flags = JSON.parse(localStorage.getItem("featureFlags") || "{}");
      flags.CHIP_QTY_BADGE = true;
      localStorage.setItem("featureFlags", JSON.stringify(flags));
      if (window.featureFlags && typeof window.featureFlags.enable === "function") {
        window.featureFlags.enable("CHIP_QTY_BADGE");
      }
    });
    await page.evaluate(() => {
      if (typeof window.renderActiveFilters === "function") window.renderActiveFilters();
      if (typeof window.renderTable === "function") window.renderTable();
    });

    const chipCounts = await page.evaluate(() => {
      const chips = document.querySelectorAll(".filter-chip, .chip");
      const counts = [];
      chips.forEach((chip) => {
        const text = chip.textContent || "";
        const match = text.match(/\((\d+)\)/);
        if (match) {
          counts.push(parseInt(match[1], 10));
        }
      });
      return counts;
    });

    expect(chipCounts.length).toBeGreaterThan(0);
    for (const count of chipCounts) {
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  test("Case 14 — precise multi-field filter narrows to exactly 1 item", async ({ page }) => {
    const fixtureAItem = {
      uuid: "stak551-fixture-a",
      metal: "Silver",
      composition: "Silver",
      name: "1 Dollar American Silver Eagle (Bullion Coin)",
      qty: 1,
      type: "Coin",
      weight: 1,
      price: 22,
      marketValue: 0,
      date: "1999-06-15",
      purchaseLocation: "tulsacoins.com",
      storageLocation: "",
      serialNumber: "",
      notes: "",
      year: "1999",
      grade: "",
      gradingAuthority: "",
      certNumber: "",
      pcgsNumber: "",
      pcgsVerified: false,
      spotPriceAtPurchase: 5.2,
      premiumPerOz: 0,
      totalPremium: 0,
      purity: 0.999,
      numistaId: "",
      serial: 401,
    };
    await page.addInitScript(
      ({ extra }) => {
        const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
        inv.push(extra);
        localStorage.setItem("metalInventory", JSON.stringify(inv));
      },
      { extra: fixtureAItem }
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 6;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Silver");
      window.applyQuickFilter("type", "Coin");
      window.applyQuickFilter("purchaseLocation", "tulsacoins.com");
      window.applyQuickFilter("year", "1999");
      window.applyQuickFilter("name", "1 Dollar American Silver Eagle (Bullion Coin)");
    });

    const uuids = await filteredUuids(page);
    expect(uuids).toEqual(["stak551-fixture-a"]);
    expect(uuids).toHaveLength(1);
    expect(await dataRowCount(page)).toBe(1);
  });
});

// ─── Coin-series cross-metal disambiguation (STRK-170 cohort 2.4 char tests) ──
// Pins filterInventoryAdvanced's two-word coin-series matching — the live,
// testable twin of search.js's _COIN_SERIES fallback (which is shadowed by the
// filterInventory→filterInventoryAdvanced delegation and could not be covered in
// cohort 2.5). These guard the behavior-preserving conversion of `matchCoinSeries`
// to a `_COIN_SERIES` table-dispatch: they pass on the pre-refactor if-cascade and
// must stay green after the table replaces it.

const COIN_SERIES_UUIDS = {
  AGE: "strk170-american-gold-eagle",
  ASE: "strk170-american-silver-eagle",
  AE: "strk170-american-eagle-bare",
  SML: "strk170-silver-maple-leaf",
  GML: "strk170-gold-maple-leaf",
};

const coinSeriesItem = (uuid, name, metal) => ({
  uuid,
  metal,
  composition: metal,
  name,
  qty: 1,
  type: "Coin",
  weight: 1,
  price: 50,
  marketValue: 0,
  date: "2025-01-01",
  purchaseLocation: "staktrakr.com",
  storageLocation: "",
  serialNumber: "",
  notes: "",
  year: "2025",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 45,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
});

const COIN_SERIES_INVENTORY = [
  coinSeriesItem(COIN_SERIES_UUIDS.AGE, "American Gold Eagle", "Gold"),
  coinSeriesItem(COIN_SERIES_UUIDS.ASE, "American Silver Eagle", "Silver"),
  coinSeriesItem(COIN_SERIES_UUIDS.AE, "American Eagle", "Silver"),
  coinSeriesItem(COIN_SERIES_UUIDS.SML, "Silver Maple Leaf", "Silver"),
  coinSeriesItem(COIN_SERIES_UUIDS.GML, "Gold Maple Leaf", "Gold"),
];

test.describe("filter-coin-series — cross-metal disambiguation (STRK-170)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((inv) => {
      localStorage.setItem("metalInventory", JSON.stringify(inv));
    }, COIN_SERIES_INVENTORY);
    await page.addInitScript(() => {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") {
            localStorage.setItem("ackVersion", APP_VERSION);
          }
        },
        { once: true }
      );
    });
    await page.goto("/index.html");
    await page.waitForFunction(
      () =>
        typeof window.filterInventory === "function" &&
        typeof window.filterInventoryAdvanced === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length === 5;
      } catch (e) {
        return false;
      }
    });
  });

  // Fill the search box and resolve once the live filter settles to expectedLen.
  const searchUuids = async (page, term, expectedLen) => {
    await page.fill("#searchInput", term);
    await page.waitForFunction((len) => {
      try {
        return window.filterInventory().length === len;
      } catch (e) {
        return false;
      }
    }, expectedLen);
    return page.evaluate(() => window.filterInventory().map((item) => item.uuid));
  };

  test('"silver eagle" matches the silver eagle only (not the gold eagle)', async ({ page }) => {
    const uuids = await searchUuids(page, "silver eagle", 1);
    expect(uuids).toEqual([COIN_SERIES_UUIDS.ASE]);
  });

  test('"gold eagle" matches the gold eagle only (not the silver eagle)', async ({ page }) => {
    const uuids = await searchUuids(page, "gold eagle", 1);
    expect(uuids).toEqual([COIN_SERIES_UUIDS.AGE]);
  });

  test('"american eagle" matches the bare American Eagle, not the metal-prefixed eagles', async ({
    page,
  }) => {
    const uuids = await searchUuids(page, "american eagle", 1);
    expect(uuids).toEqual([COIN_SERIES_UUIDS.AE]);
  });

  test('"silver maple" matches the silver maple leaf only (metalPhrase rule)', async ({ page }) => {
    const uuids = await searchUuids(page, "silver maple", 1);
    expect(uuids).toEqual([COIN_SERIES_UUIDS.SML]);
  });
});

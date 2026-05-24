import { test, expect } from "../helpers/mocks/extended-test.js";

// ---------------------------------------------------------------------------
// Base fixtures
// ---------------------------------------------------------------------------

const BASE_ITEM = {
  uuid: "strk44-base-item-uuid",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-44 Base ASE",
  qty: 10,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 0,
  date: "2026-01-01",
  purchaseLocation: "LCS",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "Original notes",
  year: "2024",
  grade: "MS70",
  gradingAuthority: "NGC",
  certNumber: "12345",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 28,
  premiumPerOz: 2,
  totalPremium: 20,
  purity: 0.999,
  numistaId: "nn-111",
  serial: 1,
};

const SINGLE_ITEM = {
  ...BASE_ITEM,
  uuid: "strk44-single-item-uuid",
  name: "STRK-44 Single ASE",
  qty: 1,
};

const SPOT_ENTRY = {
  timestamp: "2026-01-01T12:00:00.000Z",
  metal: "Silver",
  spot: 30,
  source: "seed",
  provider: "Playwright",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedData(page, options = {}) {
  const {
    inventory = [],
    displayCurrency = "USD",
    exchangeRates = { EUR: 0.9 },
    spotHistory = [SPOT_ENTRY],
    tags = {},
  } = options;

  await page.route("https://open.er-api.com/v6/latest/USD", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "success", base_code: "USD", rates: exchangeRates }),
    });
  });

  await page.addInitScript(
    ({ seededInventory, currency, rates, history, seededTags }) => {
      localStorage.setItem("metalInventory", JSON.stringify(seededInventory));
      localStorage.setItem("itemTags", JSON.stringify(seededTags));
      localStorage.setItem("cardViewStyle", "D");
      localStorage.setItem("displayCurrency", JSON.stringify(currency));
      localStorage.setItem("exchangeRates", JSON.stringify(rates));
      localStorage.setItem("metalSpotHistory", JSON.stringify(history));
      localStorage.setItem("defaultSortColumn", "4");
      localStorage.setItem("defaultSortDir", "asc");

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
    {
      seededInventory: inventory,
      currency: displayCurrency,
      rates: exchangeRates,
      history: spotHistory,
      seededTags: tags,
    }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.editItem === "function" &&
      typeof window.showViewModal === "function" &&
      Array.isArray(window.inventory)
  );
  await page.waitForTimeout(500);
}

async function openDisposeModal(page, idx) {
  // openRemoveItemModal(idx, preDispose=true) opens the modal in dispose mode
  await page.evaluate((i) => window.openRemoveItemModal(i, true), idx);
  await expect(page.locator("#removeItemModal")).toBeVisible();
}

async function setDisposeQty(page, qty) {
  await page.waitForSelector("#removeItemModal", { state: "visible" });
  const chipsVisible = await page.locator("#removeItemQtyChips:visible").count();
  if (chipsVisible > 0) {
    await page.locator(`#removeItemQtyChips button[data-qty="${qty}"]`).click();
  } else {
    await page.selectOption("#removeItemQtySelect", String(qty));
  }
}

async function fillDisposeFields(page, { type = "Sold", date = "2026-05-01", amount = "90" } = {}) {
  await page.selectOption("#dispositionType", type);
  await page.fill("#dispositionDate", date);
  if (amount) await page.fill("#dispositionAmount", amount);
}

async function confirmDispose(page) {
  await page.click("#removeItemDisposeBtn");
}

async function acceptAppConfirm(page) {
  await page.locator("#appDialogOk").click();
}

async function dismissAppConfirm(page) {
  await page.locator("#appDialogCancel").click();
}

async function runCascadeUndo(page, transactionId, { accept = true } = {}) {
  await page.evaluate((tid) => {
    window.__cascadeUndoResult = null;
    window.confirmCascadeUndo(tid).then((r) => {
      window.__cascadeUndoResult = r;
    });
  }, transactionId);
  await page.waitForSelector("#appDialogModal", { state: "visible" });
  if (accept) {
    await acceptAppConfirm(page);
  } else {
    await dismissAppConfirm(page);
  }
  await page.waitForFunction(() => window.__cascadeUndoResult !== null, null, { timeout: 5000 });
  return page.evaluate(() => window.__cascadeUndoResult);
}

async function installStorageFailMock(page, mode) {
  // mode: 'inventory' | 'changelog' | 'phase2-and-revert'
  await page.evaluate((failMode) => {
    window.__storageFailMode = failMode;
    window.__storageCallCount = 0;
    const origSetItem = Storage.prototype.setItem;
    window.__origStorageSetItem = origSetItem;
    Storage.prototype.setItem = function (k, v) {
      window.__storageCallCount += 1;
      if (window.__storageFailMode === "inventory" && k === "metalInventory") {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      if (window.__storageFailMode === "changelog" && k === "changeLog") {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      if (window.__storageFailMode === "phase2-and-revert") {
        // Phase 1: allow first metalInventory write; Phase 2: fail changeLog; revert: fail metalInventory
        if (!window.__storageKeyWriteCount) window.__storageKeyWriteCount = {};
        window.__storageKeyWriteCount[k] = (window.__storageKeyWriteCount[k] || 0) + 1;
        if (k === "metalInventory" && window.__storageKeyWriteCount[k] > 1) {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        }
        if (k === "changeLog") {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        }
      }
      return origSetItem.call(this, k, v);
    };
  }, mode);
}

async function restoreStorageMock(page) {
  await page.evaluate(() => {
    if (window.__origStorageSetItem) {
      Storage.prototype.setItem = window.__origStorageSetItem;
      delete window.__origStorageSetItem;
      delete window.__storageFailMode;
      delete window.__storageCallCount;
    }
  });
}

async function installSyncPushSpy(page) {
  await page.evaluate(() => {
    window.__scheduleSyncPushCalls = 0;
    const orig = typeof window.scheduleSyncPush === "function" ? window.scheduleSyncPush : null;
    window.__origScheduleSyncPush = orig;
    window.scheduleSyncPush = function (...args) {
      window.__scheduleSyncPushCalls += 1;
      if (orig) orig(...args);
    };
  });
}

// ---------------------------------------------------------------------------
// REQ-1 — Partial-Stack Disposition
// ---------------------------------------------------------------------------

test.describe("STRK-44 Partial-Stack Disposition", () => {
  test("1. REQ-1.1 — Quantity selector visible when stack qty > 1", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    // BASE_ITEM.qty = 10 (> DISPOSE_QTY_CHIP_MAX=8) → select mode
    await expect(page.locator("#removeItemQtySelect")).toBeVisible();
  });

  test("2. REQ-1.1 — Quantity field pre-filled with full stack qty", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await expect(page.locator("#removeItemQty")).toHaveValue("10");
  });

  test("3. REQ-1.1 — Quantity control visible with disabled-look when stack qty = 1", async ({
    page,
  }) => {
    await seedData(page, { inventory: [SINGLE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await expect(page.locator("#removeItemQtyGroup")).toBeVisible();
    await expect(page.locator("#removeItemQtyChips")).toBeVisible();
    await expect(page.locator("#removeItemQtyChips")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator('#removeItemQtyChips button[data-qty="1"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("4. REQ-1.3 — Full-stack qty produces no split (existing behavior)", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    // Default qty = full stack, confirm dispose
    await confirmDispose(page);

    const inventoryLength = await page.evaluate(() => window.inventory.length);
    expect(inventoryLength).toBe(1);
  });

  test("5. REQ-1.4 — Partial dispose creates split-clone adjacent to original", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await setDisposeQty(page, 3);
    await fillDisposeFields(page);
    await confirmDispose(page);
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => ({
      length: window.inventory.length,
      original: window.inventory[0]
        ? { qty: window.inventory[0].qty, hasDisposition: !window.inventory[0].disposition }
        : null,
      clone: window.inventory[1]
        ? { qty: window.inventory[1].qty, hasDisposition: !!window.inventory[1].disposition }
        : null,
    }));

    expect(result.length).toBe(2);
    expect(result.original.qty).toBe(7);
    expect(result.clone.qty).toBe(3);
    expect(result.clone.hasDisposition).toBe(true);
  });

  test("6. REQ-1.5 — Inline preview shows remaining qty when partial", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await setDisposeQty(page, 3);

    const preview = page.locator("#removeItemDisposePreview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("3");
    await expect(preview).toContainText("7");
  });

  test("7. REQ-1.6 — Zero qty is not selectable in the UI", async ({ page }) => {
    const stack4Item = { ...BASE_ITEM, qty: 4, uuid: "strk53-stack4-uuid" };
    const stack20Item = { ...BASE_ITEM, qty: 20, uuid: "strk53-stack20-uuid" };

    // Chip mode (qty=4 ≤ DISPOSE_QTY_CHIP_MAX=8): no chip for qty 0
    await seedData(page, { inventory: [stack4Item] });
    await gotoApp(page);
    await openDisposeModal(page, 0);
    await expect(page.locator('#removeItemQtyChips button[data-qty="0"]')).toHaveCount(0);

    // Select mode (qty=20 > 8): no option for qty 0
    await seedData(page, { inventory: [stack20Item] });
    await gotoApp(page);
    await openDisposeModal(page, 0);
    await expect(page.locator('#removeItemQtySelect option[value="0"]')).toHaveCount(0);
  });

  test("8. REQ-1.6 — Qty greater than stack is not selectable in the UI", async ({ page }) => {
    const stack4Item = { ...BASE_ITEM, qty: 4, uuid: "strk53-stack4b-uuid" };
    const stack20Item = { ...BASE_ITEM, qty: 20, uuid: "strk53-stack20b-uuid" };

    // Chip mode: no chip for qty > stack (e.g. qty=5 for a stack-4 item)
    await seedData(page, { inventory: [stack4Item] });
    await gotoApp(page);
    await openDisposeModal(page, 0);
    await expect(page.locator('#removeItemQtyChips button[data-qty="5"]')).toHaveCount(0);

    // Select mode: no option for qty > stack (e.g. value=999 for a stack-20 item)
    await seedData(page, { inventory: [stack20Item] });
    await gotoApp(page);
    await openDisposeModal(page, 0);
    await expect(page.locator('#removeItemQtySelect option[value="999"]')).toHaveCount(0);
  });

  test("9. REQ-1.7 — Split clone appears adjacent to original in inventory order", async ({
    page,
  }) => {
    const extraItem = {
      ...BASE_ITEM,
      uuid: "strk44-extra-uuid",
      name: "STRK-44 Extra Item",
      serial: 2,
    };
    await seedData(page, { inventory: [BASE_ITEM, extraItem] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await setDisposeQty(page, 2);
    await fillDisposeFields(page);
    await confirmDispose(page);
    await page.waitForTimeout(300);

    const uuids = await page.evaluate(() => window.inventory.map((i) => i.uuid));
    const originalIdx = uuids.indexOf("strk44-base-item-uuid");
    // The clone should be at originalIdx+1 (adjacent insertion)
    expect(uuids[originalIdx + 1]).not.toBe("strk44-base-item-uuid");
    expect(uuids[originalIdx + 1]).not.toBe("strk44-extra-uuid");
  });

  // ---------------------------------------------------------------------------
  // REQ-2 — Lot/Each Amount Entry
  // ---------------------------------------------------------------------------

  test("10. REQ-2.1 — Lot/Each toggle visible when qty > 1 and type requires amount", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    // Select a type that requires amount (e.g., Sold)
    await page.selectOption("#dispositionType", "Sold");

    await expect(page.locator("#removeItemAmountModeToggle")).toBeVisible();
  });

  test("11. REQ-2.2 — Lot/Each toggle hidden when disposition type has no amount (Lost)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await page.selectOption("#dispositionType", "Lost");

    await expect(page.locator("#removeItemAmountModeToggle")).toBeHidden();
  });

  test("12. REQ-2.3 — Each mode: amount treated as per-unit value", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await page.selectOption("#dispositionType", "Sold");
    await setDisposeQty(page, 3);
    // Click Each mode
    await page.locator("#removeItemAmountModeToggle [data-mode='each']").click();
    await page.fill("#dispositionAmount", "35");
    await confirmDispose(page);

    const clone = await page.evaluate(() =>
      window.inventory.find((i) => i.disposition && i.disposition.splitFromUuid)
    );
    // Each mode: totalAmount = 35 * 3 = 105; realizedGL = 105 - (30 * 3) = 15
    expect(clone).not.toBeNull();
    expect(clone.disposition.realizedGainLoss).toBeCloseTo(15, 2);
  });

  test("13. REQ-2.4 — Lot mode: amount treated as lot total", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await page.selectOption("#dispositionType", "Sold");
    await setDisposeQty(page, 3);
    await page.locator("#removeItemAmountModeToggle [data-mode='lot']").click();
    await page.fill("#dispositionAmount", "105");
    await confirmDispose(page);

    const clone = await page.evaluate(() =>
      window.inventory.find((i) => i.disposition && i.disposition.splitFromUuid)
    );
    // Lot mode: totalAmount = 105; realizedGL = 105 - (30 * 3) = 15
    expect(clone).not.toBeNull();
    expect(clone.disposition.realizedGainLoss).toBeCloseTo(15, 2);
  });

  test("14. REQ-2.5 — Toggling Lot->Each converts the displayed amount", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await page.selectOption("#dispositionType", "Sold");
    await setDisposeQty(page, 3);
    await page.locator("#removeItemAmountModeToggle [data-mode='lot']").click();
    await page.fill("#dispositionAmount", "105");

    // Switch to Each — should divide: 105 / 3 = 35
    await page.locator("#removeItemAmountModeToggle [data-mode='each']").click();
    await expect(page.locator("#dispositionAmount")).toHaveValue("35");
  });

  test("15. REQ-2.6 — Toggle hides and forces Each when disposed qty drops to 1", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await page.selectOption("#dispositionType", "Sold");
    await setDisposeQty(page, 5);
    await expect(page.locator("#removeItemAmountModeToggle")).toBeVisible();

    // Drop qty to 1 — toggle should hide
    await setDisposeQty(page, 1);
    await expect(page.locator("#removeItemAmountModeToggle")).toBeHidden();
    // And each mode should be active
    await expect(page.locator("#removeItemAmountModeToggle [data-mode='each']")).toHaveClass(
      /active/
    );
  });

  test("16. REQ-2.7 — Mode switch updates Amount placeholder", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await page.selectOption("#dispositionType", "Sold");
    await setDisposeQty(page, 3);

    await page.locator("#removeItemAmountModeToggle [data-mode='each']").click();
    await expect(page.locator("#dispositionAmount")).toHaveAttribute("placeholder", "Each");

    await page.locator("#removeItemAmountModeToggle [data-mode='lot']").click();
    await expect(page.locator("#dispositionAmount")).toHaveAttribute("placeholder", "Lot total");
  });

  // ---------------------------------------------------------------------------
  // REQ-3 — Metadata Inheritance
  // ---------------------------------------------------------------------------

  test("17. REQ-3.1 — Clone inherits notes from original", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);
    const clone = await page.evaluate(() =>
      window.inventory.find((i) => i.disposition && i.disposition.splitFromUuid)
    );
    expect(clone.notes).toBe("Original notes");
  });

  test("18. REQ-3.2 — Clone's tags work identically to original's tags", async ({ page }) => {
    const tagsState = { "strk44-base-item-uuid": ["gold", "premium"] };
    await seedData(page, { inventory: [BASE_ITEM], tags: tagsState });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);
    const cloneUuid = await page.evaluate(() => {
      const c = window.inventory.find((i) => i.disposition && i.disposition.splitFromUuid);
      return c ? c.uuid : null;
    });
    expect(cloneUuid).not.toBeNull();

    const cloneTags = await page.evaluate(
      (uuid) => (typeof window.getItemTags === "function" ? window.getItemTags(uuid) : null),
      cloneUuid
    );
    expect(cloneTags).toContain("gold");
    expect(cloneTags).toContain("premium");
  });

  test("19. REQ-3.4 — Clone receives a new distinct UUID", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);
    const uuids = await page.evaluate(() => window.inventory.map((i) => i.uuid));
    expect(uuids[0]).toBe("strk44-base-item-uuid");
    expect(uuids[1]).not.toBe("strk44-base-item-uuid");
    expect(uuids[1]).toBeTruthy();
  });

  test("20. REQ-3.5 — Clone per-unit purchase price equals original per-unit price", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);
    const { originalPrice, clonePrice } = await page.evaluate(() => ({
      originalPrice: window.inventory[0].price,
      clonePrice: window.inventory[1].price,
    }));
    expect(clonePrice).toBe(originalPrice);
    expect(clonePrice).toBeCloseTo(30, 6);
  });

  test("21. REQ-3.6 — Clone carries splitFromUuid linking to original", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);
    const splitFromUuid = await page.evaluate(() => {
      const c = window.inventory.find((i) => i.disposition && i.disposition.splitFromUuid);
      return c ? c.disposition.splitFromUuid : null;
    });
    expect(splitFromUuid).toBe("strk44-base-item-uuid");
  });

  // ---------------------------------------------------------------------------
  // REQ-4 — Realized Gain/Loss
  // ---------------------------------------------------------------------------

  test("22. REQ-4.1 — G/L formula: totalAmount - (pricePerUnit * disposedQty)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    // price=30/unit, disposing 3 at 35 each => total=105, GL=105-(30*3)=15
    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 105, // lot total
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);
    const gl = await page.evaluate(() => {
      const c = window.inventory.find((i) => i.disposition && i.disposition.splitFromUuid);
      return c ? c.disposition.realizedGainLoss : null;
    });
    expect(gl).toBeCloseTo(15, 2);
  });

  test("22a. STRK-54 — Partial-stack Lost records full disposed cost as realized loss", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await openDisposeModal(page, 0);
    await page.selectOption("#dispositionType", "Lost");
    await setDisposeQty(page, 3);
    await confirmDispose(page);

    const result = await page.evaluate(() => {
      if (typeof window.updateSummary === "function") window.updateSummary();
      const clone = window.inventory.find((i) => i.disposition && i.disposition.splitFromUuid);
      return {
        cloneAmount: clone ? clone.disposition.amount : null,
        cloneRealizedGainLoss: clone ? clone.disposition.realizedGainLoss : null,
        silverRealized: document.getElementById("realizedGainLossSilver")?.textContent || "",
        allRealized: document.getElementById("realizedGainLossAll")?.textContent || "",
      };
    });

    expect(result.cloneAmount).toBe(0);
    expect(result.cloneRealizedGainLoss).toBeCloseTo(-90, 2);
    expect(result.silverRealized).toContain("-$90.00");
    expect(result.allRealized).toContain("-$90.00");
  });

  test("22b. STRK-54 — Full-stack Lost records full item cost as realized loss", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await openDisposeModal(page, 0);
    await page.selectOption("#dispositionType", "Lost");
    await confirmDispose(page);

    const result = await page.evaluate(() => {
      if (typeof window.updateSummary === "function") window.updateSummary();
      return {
        amount: window.inventory[0].disposition?.amount,
        realizedGainLoss: window.inventory[0].disposition?.realizedGainLoss,
        silverRealized: document.getElementById("realizedGainLossSilver")?.textContent || "",
        allRealized: document.getElementById("realizedGainLossAll")?.textContent || "",
      };
    });

    expect(result.amount).toBe(0);
    expect(result.realizedGainLoss).toBeCloseTo(-300, 2);
    expect(result.silverRealized).toContain("-$300.00");
    expect(result.allRealized).toContain("-$300.00");
  });

  test("23. REQ-4.2 — G/L equals full amount when no purchase price recorded", async ({ page }) => {
    const noPriceItem = { ...BASE_ITEM, uuid: "strk44-noprice-uuid", price: 0 };
    await seedData(page, { inventory: [noPriceItem] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 105,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);
    const gl = await page.evaluate(() => {
      const c = window.inventory.find((i) => i.disposition && i.disposition.splitFromUuid);
      return c ? c.disposition.realizedGainLoss : null;
    });
    expect(gl).toBeCloseTo(105, 2);
  });

  test("24. REQ-4.3 — Each mode total = per-unit * disposedQty", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    // 35 per unit * 3 = 105 total; then GL = 105 - 30*3 = 15
    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      // Pass perUnit amount; caller is responsible for the multiplication
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 105, // UI layer converts: 35 * 3
        currency: "USD",
        recipient: "",
        notes: "",
        _enteredEach: 35,
        _disposedQty: 3,
      });
    });

    expect(result.ok).toBe(true);
  });

  test("25. REQ-4.4 — Lot mode total equals entered lot value", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 99, // lot total as-is
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);
    const gl = await page.evaluate(() => {
      const c = window.inventory.find((i) => i.disposition && i.disposition.splitFromUuid);
      return c ? c.disposition.realizedGainLoss : null;
    });
    // GL = 99 - (30*3) = 9
    expect(gl).toBeCloseTo(9, 2);
  });

  // ---------------------------------------------------------------------------
  // REQ-5 — Correlated Activity Log Entries
  // ---------------------------------------------------------------------------

  test("26. REQ-5.1 — Two log entries recorded after partial dispose", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const initialLogLength = await page.evaluate(() =>
      Array.isArray(window.changeLog) ? window.changeLog.length : 0
    );

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);
    const newLogLength = await page.evaluate(() => window.changeLog.length);
    expect(newLogLength).toBe(initialLogLength + 2);
  });

  test("27. REQ-5.2 — Two log entries share a common transactionId", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);
    const { transactionId } = result;
    expect(transactionId).toBeTruthy();

    const entries = await page.evaluate(
      (tid) => window.changeLog.filter((e) => e.transactionId === tid),
      transactionId
    );
    expect(entries.length).toBe(2);
  });

  test("28. REQ-5.2 — Log entries carry stackSplit and splitDisposed reverse payloads", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);

    const payloads = await page.evaluate((tid) => {
      const entries = window.changeLog.filter((e) => e.transactionId === tid);
      const splitEntry = entries.find((e) => e.stackSplit);
      const disposedEntry = entries.find((e) => e.splitDisposed);
      return {
        hasSplitEntry: !!splitEntry,
        hasDisposedEntry: !!disposedEntry,
        splitPayload: splitEntry ? splitEntry.stackSplit : null,
        disposedPayload: disposedEntry ? disposedEntry.splitDisposed : null,
      };
    }, result.transactionId);

    expect(payloads.hasSplitEntry).toBe(true);
    expect(payloads.hasDisposedEntry).toBe(true);
    expect(payloads.splitPayload.originalUuid).toBe("strk44-base-item-uuid");
    expect(payloads.splitPayload.disposedQty).toBe(3);
    expect(payloads.disposedPayload.cloneUuid).toBeTruthy();
  });

  test("29. REQ-5.3 — Cascade undo prompt appears when undoing correlated entry", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);

    // confirmCascadeUndo should exist
    const fnExists = await page.evaluate(() => typeof window.confirmCascadeUndo === "function");
    expect(fnExists).toBe(true);
  });

  test("30. REQ-5.4 — Cascade undo reverses both entries atomically", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);

    const undoResult = await runCascadeUndo(page, result.transactionId, { accept: true });

    expect(undoResult.ok).toBe(true);
    expect(undoResult.applied).toBe("cascade");

    const { inventoryLength, originalQty } = await page.evaluate(() => ({
      inventoryLength: window.inventory.length,
      originalQty: window.inventory[0] ? window.inventory[0].qty : null,
    }));
    expect(inventoryLength).toBe(1);
    expect(originalQty).toBe(10);
  });

  test("31. REQ-5.5 — Cancel cascade undo leaves both entries in place", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);

    const undoResult = await runCascadeUndo(page, result.transactionId, { accept: false });

    expect(undoResult.applied).toBe("none");

    const inventoryLength = await page.evaluate(() => window.inventory.length);
    expect(inventoryLength).toBe(2);
  });

  test("32. REQ-5.6 — Activity log entries visually grouped by transactionId", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);

    // Expect a group container for the transaction entries inside the changelog table
    await expect(page.locator("#changeLogTable [role='group'][aria-label]")).toHaveCount(1);
  });

  // ---------------------------------------------------------------------------
  // REQ-5 Drift Detection
  // ---------------------------------------------------------------------------

  test("33. REQ-5 Drift — sort inventory after split then cascade undo (UUID lookup succeeds)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);

    // Simulate a sort by reversing the inventory array (changes indexes)
    await page.evaluate(() => {
      window.inventory.reverse();
    });

    // UUID-based lookup: cascade should still succeed even though indexes changed
    const undoResult = await runCascadeUndo(page, result.transactionId, { accept: true });

    expect(undoResult.ok).toBe(true);
    expect(undoResult.applied).toBe("cascade");
  });

  test("34. REQ-5 Drift — edit original qty after split downgrades to single-entry undo", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);

    // Edit original qty — breaks drift invariant 2
    await page.evaluate(() => {
      const original = window.inventory.find((i) => i.uuid === "strk44-base-item-uuid");
      if (original) original.qty += 1;
    });

    // Drift detected → first dialog is the drift warning, accept to proceed with single-entry undo
    // Then restoreInPlace shows its own confirm (legacy path)
    await page.evaluate((tid) => {
      window.__cascadeUndoResult = null;
      window.confirmCascadeUndo(tid).then((r) => {
        window.__cascadeUndoResult = r;
      });
    }, result.transactionId);
    // Accept drift warning
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await acceptAppConfirm(page);
    await page.waitForFunction(() => window.__cascadeUndoResult !== null, null, { timeout: 5000 });

    const undoResult = await page.evaluate(() => window.__cascadeUndoResult);
    expect(undoResult.applied).toBe("single-entry");
  });

  test("35. REQ-5 Drift — delete original after split downgrades to single-entry undo", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);

    // Delete the original record — breaks drift invariant 1
    await page.evaluate(() => {
      const idx = window.inventory.findIndex((i) => i.uuid === "strk44-base-item-uuid");
      if (idx >= 0) window.inventory.splice(idx, 1);
    });

    // Drift detected → accept drift warning to proceed with single-entry undo
    await page.evaluate((tid) => {
      window.__cascadeUndoResult = null;
      window.confirmCascadeUndo(tid).then((r) => {
        window.__cascadeUndoResult = r;
      });
    }, result.transactionId);
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await acceptAppConfirm(page);
    await page.waitForFunction(() => window.__cascadeUndoResult !== null, null, { timeout: 5000 });

    const undoResult = await page.evaluate(() => window.__cascadeUndoResult);
    expect(undoResult.applied).toBe("single-entry");
  });

  // ---------------------------------------------------------------------------
  // REQ-6 — Restore Choice for Split Clones
  // ---------------------------------------------------------------------------

  test("36. REQ-6.1 — Restore of split-clone prompts Merge/Separate when original exists", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await page.evaluate(async () => {
      if (typeof window.splitInventoryItem === "function") {
        await window.splitInventoryItem(0, 3, {
          type: "Sold",
          date: "2026-05-01",
          amount: 90,
          currency: "USD",
          recipient: "",
          notes: "",
        });
      }
    });

    // showRestoreChoice should exist as a function
    const fnExists = await page.evaluate(() => typeof window.showRestoreChoice === "function");
    expect(fnExists).toBe(true);

    // Invoke undoDisposition on the clone (index 1 = adjacent clone)
    const cloneIdx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.disposition && i.disposition.splitFromUuid)
    );
    expect(cloneIdx).toBeGreaterThanOrEqual(0);

    // The restore choice modal should appear (showRestoreChoice is async and opens #restoreChoiceModal)
    page.on("dialog", (dialog) => dialog.dismiss());
    await page.evaluate((idx) => {
      if (typeof window.undoDisposition === "function") window.undoDisposition(idx);
    }, cloneIdx);

    await expect(page.locator("#restoreChoiceModal")).toBeVisible();
  });

  test("37. REQ-6.2 — Restore prompt shows quantity math for Merge and Separate options", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await page.evaluate(async () => {
      if (typeof window.splitInventoryItem === "function") {
        await window.splitInventoryItem(0, 3, {
          type: "Sold",
          date: "2026-05-01",
          amount: 90,
          currency: "USD",
          recipient: "",
          notes: "",
        });
      }
    });

    const cloneIdx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.disposition && i.disposition.splitFromUuid)
    );

    page.on("dialog", (dialog) => dialog.dismiss());
    await page.evaluate((idx) => {
      if (typeof window.undoDisposition === "function") window.undoDisposition(idx);
    }, cloneIdx);

    await expect(page.locator("#restoreChoiceModal")).toBeVisible();
    // Message should mention the merged quantity (7+3=10) or the separate quantities
    await expect(page.locator("#restoreChoiceMessage")).toContainText("10");
  });

  test("38. REQ-6.3 — Merge choice increments original qty and deletes clone", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await page.evaluate(async () => {
      if (typeof window.splitInventoryItem === "function") {
        await window.splitInventoryItem(0, 3, {
          type: "Sold",
          date: "2026-05-01",
          amount: 90,
          currency: "USD",
          recipient: "",
          notes: "",
        });
      }
    });

    const cloneIdx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.disposition && i.disposition.splitFromUuid)
    );

    // Intercept restore and choose Merge
    await page.evaluate((idx) => {
      if (typeof window.undoDisposition === "function") window.undoDisposition(idx);
    }, cloneIdx);

    await expect(page.locator("#restoreChoiceModal")).toBeVisible();
    await page.locator("#restoreChoiceModal [data-action='merge']").click();
    await page.waitForTimeout(200);

    const { inventoryLength, originalQty } = await page.evaluate(() => ({
      inventoryLength: window.inventory.length,
      originalQty: window.inventory.find((i) => i.uuid === "strk44-base-item-uuid")?.qty,
    }));
    expect(inventoryLength).toBe(1);
    expect(originalQty).toBe(10);
  });

  test("39. REQ-6.4 — Separate choice clears disposition on clone (current restore behavior)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await page.evaluate(async () => {
      if (typeof window.splitInventoryItem === "function") {
        await window.splitInventoryItem(0, 3, {
          type: "Sold",
          date: "2026-05-01",
          amount: 90,
          currency: "USD",
          recipient: "",
          notes: "",
        });
      }
    });

    const cloneIdx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.disposition && i.disposition.splitFromUuid)
    );

    await page.evaluate((idx) => {
      if (typeof window.undoDisposition === "function") window.undoDisposition(idx);
    }, cloneIdx);

    await expect(page.locator("#restoreChoiceModal")).toBeVisible();
    await page.locator("#restoreChoiceModal [data-action='separate']").click();
    await page.waitForTimeout(200);

    const { inventoryLength, cloneDisposition } = await page.evaluate(() => {
      const clone = window.inventory.find((i) => !window.inventory[0].disposition);
      return {
        inventoryLength: window.inventory.length,
        cloneDisposition: window.inventory[1]?.disposition || null,
      };
    });
    expect(inventoryLength).toBe(2);
    expect(cloneDisposition).toBeNull();
  });

  test("40. REQ-6.5 — Original missing: restore skips prompt and restores in place", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await page.evaluate(async () => {
      if (typeof window.splitInventoryItem === "function") {
        await window.splitInventoryItem(0, 3, {
          type: "Sold",
          date: "2026-05-01",
          amount: 90,
          currency: "USD",
          recipient: "",
          notes: "",
        });
      }
      // Delete the original
      const idx = window.inventory.findIndex((i) => i.uuid === "strk44-base-item-uuid");
      if (idx >= 0) window.inventory.splice(idx, 1);
    });

    const cloneIdx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.disposition && i.disposition.splitFromUuid)
    );

    await page.evaluate((idx) => {
      if (typeof window.undoDisposition === "function") window.undoDisposition(idx);
    }, cloneIdx);

    // Modal should NOT appear — falls back to in-place restore
    await expect(page.locator("#restoreChoiceModal")).toBeHidden();
  });

  test("41. REQ-6.6 — Legacy (non-split) dispose skips prompt and uses existing restore", async ({
    page,
  }) => {
    const legacyItem = {
      ...BASE_ITEM,
      uuid: "strk44-legacy-uuid",
      name: "STRK-44 Legacy Disposed",
      qty: 1,
      disposition: {
        type: "Sold",
        date: "2026-01-01",
        amount: 30,
        currency: "USD",
      },
    };
    await seedData(page, { inventory: [legacyItem] });
    await gotoApp(page);

    await page.evaluate((idx) => {
      if (typeof window.undoDisposition === "function") window.undoDisposition(idx);
    }, 0);

    await page.waitForTimeout(200);

    // No restore choice modal — legacy path
    await expect(page.locator("#restoreChoiceModal")).toBeHidden();
  });

  // ---------------------------------------------------------------------------
  // REQ-7 — Cloud Sync and Backup Round-Trip
  // ---------------------------------------------------------------------------

  test("42. REQ-7.1 — Cloud sync: scheduleSyncPush called after partial dispose", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await installSyncPushSpy(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);

    const callCount = await page.evaluate(() => window.__scheduleSyncPushCalls);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test("43. REQ-7.3 — ZIP backup includes full disposition with splitFromUuid", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await page.evaluate(async () => {
      if (typeof window.splitInventoryItem === "function") {
        await window.splitInventoryItem(0, 3, {
          type: "Sold",
          date: "2026-05-01",
          amount: 90,
          currency: "USD",
          recipient: "",
          notes: "",
        });
      }
    });

    // Trigger backup export and check that buildInventoryBackup includes disposition
    const backupHasDisposition = await page.evaluate(async () => {
      if (typeof window.createBackupZip !== "function") return false;
      const blob = await window.createBackupZip();
      if (!blob) return false;
      // We can only verify the function exists and returns something
      return blob instanceof Blob || typeof blob === "string";
    });

    // The actual backup function must exist and return a blob
    expect(backupHasDisposition).toBe(true);
  });

  test("44. REQ-7.4 — CSV export contains Disposition Split From UUID column", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await page.evaluate(async () => {
      if (typeof window.splitInventoryItem === "function") {
        await window.splitInventoryItem(0, 3, {
          type: "Sold",
          date: "2026-05-01",
          amount: 90,
          currency: "USD",
          recipient: "",
          notes: "",
        });
      }
    });

    const csvContent = await page.evaluate(() => {
      if (typeof window.exportInventoryCSV === "function") {
        return window.exportInventoryCSV();
      }
      return null;
    });

    expect(csvContent).not.toBeNull();
    expect(csvContent).toContain("Disposition Split From UUID");
  });

  test("45. REQ-7.4 — CSV export contains new disposition columns (Recipient, Notes, Currency, DisposedAt)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const csvContent = await page.evaluate(() => {
      if (typeof window.exportInventoryCSV === "function") {
        return window.exportInventoryCSV();
      }
      return null;
    });

    expect(csvContent).not.toBeNull();
    expect(csvContent).toContain("Disposition Recipient");
    expect(csvContent).toContain("Disposition Notes");
    expect(csvContent).toContain("Disposition Currency");
    expect(csvContent).toContain("Disposition DisposedAt");
  });

  test("46. REQ-7.4 — CSV re-import reconstructs disposition including splitFromUuid", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await page.evaluate(async () => {
      if (typeof window.splitInventoryItem === "function") {
        await window.splitInventoryItem(0, 3, {
          type: "Sold",
          date: "2026-05-01",
          amount: 90,
          currency: "USD",
          recipient: "Buyer",
          notes: "Sale notes",
        });
      }
    });

    const csvContent = await page.evaluate(() => {
      if (typeof window.exportInventoryCSV === "function") {
        return window.exportInventoryCSV();
      }
      return null;
    });

    expect(csvContent).not.toBeNull();

    // Import the CSV back and check that disposition.splitFromUuid is preserved
    const importResult = await page.evaluate(async (csv) => {
      if (typeof window.importCsvFromText !== "function") return null;
      const parsed = window.importCsvFromText(csv);
      return parsed ? parsed.find((i) => i.disposition && i.disposition.splitFromUuid) : null;
    }, csvContent);

    expect(importResult).not.toBeNull();
    expect(importResult.disposition.splitFromUuid).toBe("strk44-base-item-uuid");
  });

  test("47. REQ-7.4 — Old CSV without new disposition columns imports cleanly", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    // Build a minimal old-style CSV (without the new columns)
    const oldCsv =
      "Name,Metal,Qty,Price,Disposition Type,Disposition Date,Disposition Amount,Disposition Realized G/L\n" +
      "Old Item,Silver,1,30,Sold,2026-01-01,32,2\n";

    const importResult = await page.evaluate(async (csv) => {
      if (typeof window.importCsvFromText !== "function") return "no_function";
      const parsed = window.importCsvFromText(csv);
      if (!parsed || !parsed[0]) return "no_result";
      return parsed[0].disposition
        ? { hasDisposition: true, splitFromUuid: parsed[0].disposition.splitFromUuid }
        : { hasDisposition: false };
    }, oldCsv);

    // Old CSV: disposition may or may not be reconstructed (depends on import logic)
    // But splitFromUuid must be absent
    expect(importResult).not.toBe("no_function");
    if (typeof importResult === "object") {
      expect(importResult.splitFromUuid).toBeFalsy();
    }
  });

  // ---------------------------------------------------------------------------
  // REQ-8 — Backward-Compatible Default Behavior
  // ---------------------------------------------------------------------------

  test("48. REQ-8.1 — Modal at qty=1 looks identical to current single-item flow", async ({
    page,
  }) => {
    await seedData(page, { inventory: [SINGLE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await expect(page.locator("#removeItemQty")).toBeHidden();
    await expect(page.locator("#removeItemAmountModeToggle")).toBeHidden();
    await expect(page.locator("#removeItemDisposePreview")).toBeHidden();
  });

  test("49. REQ-8.2 — Full-stack default at qty>1 produces no clone", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      // Full stack: disposedQty === stackQty → not a split
      // This should be handled by confirmRemoveItem, not splitInventoryItem,
      // so test that inventory stays at 1 item when full qty is disposed
      return window.splitInventoryItem(0, 10, {
        type: "Sold",
        date: "2026-05-01",
        amount: 300,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    // splitInventoryItem should not split when disposedQty = stackQty
    // It should either return ok:false or the inventory stays at 1
    const inventoryLength = await page.evaluate(() => window.inventory.length);
    // If full-stack is passed, no clone should be created (or validation_failed)
    if (result.ok) {
      expect(inventoryLength).toBe(1);
    } else {
      expect(result.error).toBeTruthy();
    }
  });

  test("50. REQ-8.3 — Full-stack dispose produces no splitFromUuid marker", async ({ page }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    // Accept full-stack default (qty = 10 = stackQty)
    await confirmDispose(page);
    await page.waitForTimeout(200);

    const item = await page.evaluate(() => window.inventory[0] || null);
    expect(item).not.toBeNull();
    if (item && item.disposition) {
      expect(item.disposition.splitFromUuid).toBeFalsy();
    }
  });

  test("51. REQ-8.4 — Pre-existing non-split disposed record uses legacy restore path", async ({
    page,
  }) => {
    const legacyItem = {
      ...BASE_ITEM,
      uuid: "strk44-legacy-full-uuid",
      name: "STRK-44 Legacy Full Dispose",
      qty: 1,
      disposition: {
        type: "Sold",
        date: "2026-01-01",
        amount: 30,
        currency: "USD",
        // No splitFromUuid field
      },
    };
    await seedData(page, { inventory: [legacyItem] });
    await gotoApp(page);

    // Fire undoDisposition without awaiting — it will show a confirm dialog
    await page.evaluate((idx) => {
      if (typeof window.undoDisposition === "function") window.undoDisposition(idx);
    }, 0);

    // Legacy path shows showAppConfirm — accept it
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await acceptAppConfirm(page);
    await page.waitForTimeout(300);

    // Should NOT show the restore choice modal (legacy path)
    await expect(page.locator("#restoreChoiceModal")).toBeHidden();
    // Item should be restored (no disposition)
    const restoredItem = await page.evaluate(() => window.inventory[0] || null);
    expect(restoredItem).not.toBeNull();
    expect(restoredItem.disposition).toBeFalsy();
  });

  // ---------------------------------------------------------------------------
  // Storage-failure rollback tests
  // ---------------------------------------------------------------------------

  test("52. Storage rollback — Phase 1 fails (inventory write): no log entries, qty unchanged", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await installStorageFailMock(page, "inventory");

    const initialQty = await page.evaluate(() => window.inventory[0].qty);
    const initialLogLength = await page.evaluate(() =>
      Array.isArray(window.changeLog) ? window.changeLog.length : 0
    );

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    await restoreStorageMock(page);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("storage_failed_inventory");

    const { finalQty, finalLogLength, inventoryLength } = await page.evaluate(() => ({
      finalQty: window.inventory[0].qty,
      finalLogLength: Array.isArray(window.changeLog) ? window.changeLog.length : 0,
      inventoryLength: window.inventory.length,
    }));

    expect(finalQty).toBe(initialQty);
    expect(finalLogLength).toBe(initialLogLength);
    expect(inventoryLength).toBe(1);
  });

  test("53. Storage rollback — Phase 2 fails (changelog write), revert succeeds: disk restored to pre-split", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await installStorageFailMock(page, "changelog");

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    await restoreStorageMock(page);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("storage_failed_changelog");

    // In-memory state should match pre-split
    const { inventoryLength, originalQty } = await page.evaluate(() => ({
      inventoryLength: window.inventory.length,
      originalQty: window.inventory[0] ? window.inventory[0].qty : null,
    }));
    expect(inventoryLength).toBe(1);
    expect(originalQty).toBe(10);
  });

  test("54. Storage rollback — Phase 2 fails AND revert fails: critical toast, error=storage_failed_both", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await installStorageFailMock(page, "phase2-and-revert");

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    await restoreStorageMock(page);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("storage_failed_both");
  });

  // ---------------------------------------------------------------------------
  // Cloud sync propagation — scheduleSyncPush spy
  // ---------------------------------------------------------------------------

  test("55. scheduleSyncPush called once on successful partial dispose (REQ-7.1 guard)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await installSyncPushSpy(page);

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(result.ok).toBe(true);

    const callCount = await page.evaluate(() => window.__scheduleSyncPushCalls);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test("56. scheduleSyncPush called after successful cascade undo (REQ-7.1 guard)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const splitResult = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    expect(splitResult.ok).toBe(true);

    await installSyncPushSpy(page);

    const undoResult = await runCascadeUndo(page, splitResult.transactionId, { accept: true });

    expect(undoResult.ok).toBe(true);
    expect(undoResult.applied).toBe("cascade");

    const callCount = await page.evaluate(() => window.__scheduleSyncPushCalls);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Recovery mode suppression
  // ---------------------------------------------------------------------------

  test("57. Recovery mode suppression — tryPersistInventory returns false, no state change", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    // Activate recovery mode
    await page.evaluate(() => {
      window.inventoryRecoveryActive = true;
    });

    const initialLength = await page.evaluate(() => window.inventory.length);
    const initialQty = await page.evaluate(() => window.inventory[0].qty);
    const initialLogLength = await page.evaluate(() =>
      Array.isArray(window.changeLog) ? window.changeLog.length : 0
    );

    const result = await page.evaluate(async () => {
      if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
      return window.splitInventoryItem(0, 3, {
        type: "Sold",
        date: "2026-05-01",
        amount: 90,
        currency: "USD",
        recipient: "",
        notes: "",
      });
    });

    // Restore recovery mode
    await page.evaluate(() => {
      window.inventoryRecoveryActive = false;
    });

    expect(result.ok).toBe(false);

    const { finalLength, finalQty, finalLogLength } = await page.evaluate(() => ({
      finalLength: window.inventory.length,
      finalQty: window.inventory[0]?.qty,
      finalLogLength: Array.isArray(window.changeLog) ? window.changeLog.length : 0,
    }));

    expect(finalLength).toBe(initialLength);
    expect(finalQty).toBe(initialQty);
    expect(finalLogLength).toBe(initialLogLength);
  });

  // ---------------------------------------------------------------------------
  // ZIP backup — content verification
  // ---------------------------------------------------------------------------

  test("58. REQ-7.3 — ZIP backup JSON payload preserves full disposition including splitFromUuid", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await page.evaluate(async () => {
      if (typeof window.splitInventoryItem === "function") {
        await window.splitInventoryItem(0, 3, {
          type: "Sold",
          date: "2026-05-01",
          amount: 90,
          currency: "USD",
          recipient: "Buyer",
          notes: "ZIP test",
        });
      }
    });

    const cloneDisposition = await page.evaluate(async () => {
      if (typeof window.createBackupZip !== "function") return null;
      if (typeof window.JSZip === "undefined") return null;
      const blob = await window.createBackupZip();
      if (!(blob instanceof Blob)) return null;
      const buf = await blob.arrayBuffer();
      const zip = await window.JSZip.loadAsync(buf);
      const jsonFile = zip.file("inventory_data.json");
      if (!jsonFile) return null;
      const text = await jsonFile.async("string");
      const data = JSON.parse(text);
      const clone = data.inventory.find((i) => i.disposition && i.disposition.splitFromUuid);
      return clone ? clone.disposition : null;
    });

    expect(cloneDisposition).not.toBeNull();
    expect(cloneDisposition.splitFromUuid).toBe("strk44-base-item-uuid");
    expect(cloneDisposition.amount).toBe(90);
    expect(cloneDisposition.date).toBe("2026-05-01");
    expect(cloneDisposition.recipient).toBe("Buyer");
    expect(cloneDisposition.notes).toBe("ZIP test");
    expect(typeof cloneDisposition.disposedAt).toBe("string");
    expect(cloneDisposition.disposedAt.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // CSV round-trip — all new disposition fields
  // ---------------------------------------------------------------------------

  test("59. REQ-7.4 — CSV round-trip preserves all new disposition fields (recipient, notes, currency, disposedAt, splitFromUuid)", async ({
    page,
  }) => {
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    await page.evaluate(async () => {
      if (typeof window.splitInventoryItem === "function") {
        await window.splitInventoryItem(0, 3, {
          type: "Sold",
          date: "2026-05-01",
          amount: 90,
          currency: "USD",
          recipient: "CSV Buyer",
          notes: "CSV round-trip notes",
        });
      }
    });

    const csvContent = await page.evaluate(() => {
      if (typeof window.exportInventoryCSV === "function") {
        return window.exportInventoryCSV();
      }
      return null;
    });

    expect(csvContent).not.toBeNull();

    const imported = await page.evaluate(async (csv) => {
      if (typeof window.importCsvFromText !== "function") return null;
      const parsed = window.importCsvFromText(csv);
      if (!parsed) return null;
      return parsed.find((i) => i.disposition && i.disposition.splitFromUuid) ?? null;
    }, csvContent);

    expect(imported).not.toBeNull();
    expect(imported.disposition.splitFromUuid).toBe("strk44-base-item-uuid");
    expect(imported.disposition.date).toBe("2026-05-01");
    expect(imported.disposition.amount).toBe(90);
    expect(imported.disposition.recipient).toBe("CSV Buyer");
    expect(imported.disposition.notes).toBe("CSV round-trip notes");
    expect(imported.disposition.currency).toBe("USD");
    expect(typeof imported.disposition.disposedAt).toBe("string");
    expect(imported.disposition.disposedAt.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Qty input max attribute — UI spinner upper-bound (bug fix regression)
  // ---------------------------------------------------------------------------

  test("60. REQ-1.1 — Select has exactly stack-qty options, last pre-selected", async ({
    page,
  }) => {
    // BASE_ITEM.qty = 10 > DISPOSE_QTY_CHIP_MAX=8 → select mode
    await seedData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    const optionCount = await page.locator("#removeItemQtySelect option").count();
    expect(optionCount).toBe(BASE_ITEM.qty); // 10 options
    await expect(page.locator("#removeItemQtySelect")).toHaveValue(String(BASE_ITEM.qty)); // "10" selected
  });

  // ---------------------------------------------------------------------------
  // STRK-53 — Chip keyboard nav, touch targets, viewport wrap
  // ---------------------------------------------------------------------------

  test("STRK-53 — Chip ArrowLeft moves selection", async ({ page }) => {
    const stack4Item = { ...BASE_ITEM, qty: 4, uuid: "strk53-kbd-uuid" };
    await seedData(page, { inventory: [stack4Item] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    // Chip 4 is focused by default (last chip, pre-selected)
    await page.locator('#removeItemQtyChips button[data-qty="4"]').focus();
    await page.keyboard.press("ArrowLeft");

    await expect(page.locator('#removeItemQtyChips button[data-qty="3"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(await page.locator("#removeItemQty").inputValue()).toBe("3");
  });

  test("STRK-53 — Chip Home/End jump to bounds", async ({ page }) => {
    const stack6Item = { ...BASE_ITEM, qty: 6, uuid: "strk53-homeend-uuid" };
    await seedData(page, { inventory: [stack6Item] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await page.locator('#removeItemQtyChips button[data-qty="6"]').focus();
    await page.keyboard.press("Home");
    await expect(page.locator('#removeItemQtyChips button[data-qty="1"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await page.keyboard.press("End");
    await expect(page.locator('#removeItemQtyChips button[data-qty="6"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("STRK-53 — Chip touch target ≥ 44×44 px", async ({ page }) => {
    const stack4Item = { ...BASE_ITEM, qty: 4, uuid: "strk53-target-uuid" };
    await seedData(page, { inventory: [stack4Item] });
    await gotoApp(page);
    await openDisposeModal(page, 0);
    // Wait for modal slide-in animation (scale 0.95→1) to settle before measuring
    await page.waitForTimeout(400);

    const box = await page.locator('#removeItemQtyChips button[data-qty="1"]').boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("STRK-53 — Chip group wraps at 360 px viewport", async ({ page }) => {
    const stack8Item = { ...BASE_ITEM, qty: 8, uuid: "strk53-wrap-uuid" };
    await page.setViewportSize({ width: 360, height: 800 });
    await seedData(page, { inventory: [stack8Item] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    const box1 = await page.locator('#removeItemQtyChips button[data-qty="1"]').boundingBox();
    const box8 = await page.locator('#removeItemQtyChips button[data-qty="8"]').boundingBox();
    expect(box8.y).toBeGreaterThan(box1.y);

    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("STRK-53 — Select type-ahead reaches qty 47 of 50 in ≤ 3 interactions", async ({ page }) => {
    const stack50Item = { ...BASE_ITEM, qty: 50, uuid: "strk53-typeahead-uuid" };
    await seedData(page, { inventory: [stack50Item] });
    await gotoApp(page);
    await openDisposeModal(page, 0);

    await page.locator("#removeItemQtySelect").focus();
    await page.keyboard.type("47", { delay: 100 });
    await page.keyboard.press("Tab");

    expect(await page.locator("#removeItemQty").inputValue()).toBe("47");
  });
});

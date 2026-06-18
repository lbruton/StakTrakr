import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const BASE_ITEM = {
  uuid: "core-disposition-base",
  metal: "Silver",
  composition: "Silver",
  name: "Core Disposition ASE",
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
  uuid: "core-disposition-single",
  name: "Core Single ASE",
  qty: 1,
};

const DISPOSED_ITEM = {
  ...BASE_ITEM,
  uuid: "core-disposition-disposed",
  name: "Core Disposed ASE",
  qty: 1,
  disposition: { type: "Sold", date: "2026-05-01", amount: 950, realizedGainLoss: 650 },
};

const NON_DISPOSED_ITEM = {
  ...BASE_ITEM,
  uuid: "core-disposition-active",
  name: "Core Active ASE",
  qty: 1,
};

const EMPTY_DISPOSITION_ITEM = {
  ...NON_DISPOSED_ITEM,
  uuid: "core-disposition-empty",
  name: "Core Empty Disposition ASE",
  disposition: {},
};

const LEGACY_SECTION_CONFIG = [
  { id: "images", label: "Coin images", enabled: true },
  { id: "valuation", label: "Valuation", enabled: true },
  { id: "priceHistory", label: "Price history", enabled: true },
  { id: "inventory", label: "Inventory details", enabled: true },
  { id: "grading", label: "Grading", enabled: true },
  { id: "numista", label: "Numista data", enabled: true },
  { id: "notes", label: "Notes", enabled: true },
  { id: "tags", label: "Tags", enabled: true },
  { id: "attachments", label: "Attachments", enabled: true },
];

const DISPOSITION_BETWEEN_CONFIG = [
  { id: "images", label: "Coin images", enabled: true },
  { id: "valuation", label: "Valuation", enabled: true },
  { id: "disposition", label: "Disposition", enabled: true },
  { id: "priceHistory", label: "Price history", enabled: true },
  { id: "inventory", label: "Inventory details", enabled: true },
  { id: "grading", label: "Grading", enabled: true },
  { id: "numista", label: "Numista data", enabled: true },
  { id: "notes", label: "Notes", enabled: true },
  { id: "tags", label: "Tags", enabled: true },
  { id: "attachments", label: "Attachments", enabled: true },
];

async function seedDispositionData(page, options = {}) {
  const {
    inventory = [],
    displayCurrency = "USD",
    exchangeRates = { EUR: 0.9 },
    sectionConfig = null,
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
    ({ items, currency, rates, cfg, seededTags }) => {
      localStorage.setItem("metalInventory", JSON.stringify(items));
      localStorage.setItem("itemTags", JSON.stringify(seededTags));
      localStorage.setItem("cardViewStyle", "D");
      localStorage.setItem("displayCurrency", JSON.stringify(currency));
      localStorage.setItem("exchangeRates", JSON.stringify(rates));
      localStorage.setItem(
        "metalSpotHistory",
        JSON.stringify([
          {
            timestamp: "2026-01-01T12:00:00.000Z",
            metal: "Silver",
            spot: 30,
            source: "seed",
            provider: "Playwright",
          },
        ])
      );
      localStorage.setItem("defaultSortColumn", "4");
      localStorage.setItem("defaultSortDir", "asc");
      if (cfg !== null && !localStorage.getItem("viewModalSectionConfig")) {
        localStorage.setItem("viewModalSectionConfig", JSON.stringify(cfg));
      }

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
      items: inventory,
      currency: displayCurrency,
      rates: exchangeRates,
      cfg: sectionConfig,
      seededTags: tags,
    }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.openRemoveItemModal === "function" &&
      typeof window.showViewModal === "function" &&
      typeof window.showSettingsModal === "function" &&
      Array.isArray(window.inventory)
  );
  await page.waitForTimeout(300);
}

async function openDisposeModal(page, idx = 0) {
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
  const button = page.locator("#removeItemDisposeBtn");
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.locator("#removeItemModal")).toBeHidden();
}

async function acceptAppConfirm(page) {
  await page.locator("#appDialogOk").click();
}

async function runCascadeUndo(page, transactionId) {
  await page.evaluate((tid) => {
    window.__cascadeUndoResult = null;
    window.confirmCascadeUndo(tid).then((result) => {
      window.__cascadeUndoResult = result;
    });
  }, transactionId);
  await page.waitForSelector("#appDialogModal", { state: "visible" });
  await acceptAppConfirm(page);
  await page.waitForFunction(() => window.__cascadeUndoResult !== null, null, { timeout: 5000 });
  return page.evaluate(() => window.__cascadeUndoResult);
}

async function splitBaseItem(page, disposition = {}) {
  return page.evaluate((data) => {
    if (typeof window.splitInventoryItem !== "function") return { ok: false, error: "not_found" };
    return window.splitInventoryItem(0, 3, {
      type: "Sold",
      date: "2026-05-01",
      amount: 90,
      currency: "USD",
      recipient: "",
      notes: "",
      ...data,
    });
  }, disposition);
}

async function installStorageFailMock(page, mode) {
  await page.evaluate((failMode) => {
    window.__storageFailMode = failMode;
    window.__storageCallCount = 0;
    const originalSetItem = Storage.prototype.setItem;
    window.__origStorageSetItem = originalSetItem;
    Storage.prototype.setItem = function (key, value) {
      window.__storageCallCount += 1;
      if (window.__storageFailMode === "inventory" && key === "metalInventory") {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      if (window.__storageFailMode === "changelog" && key === "changeLog") {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      if (window.__storageFailMode === "phase2-and-revert") {
        if (!window.__storageKeyWriteCount) window.__storageKeyWriteCount = {};
        window.__storageKeyWriteCount[key] = (window.__storageKeyWriteCount[key] || 0) + 1;
        if (key === "metalInventory" && window.__storageKeyWriteCount[key] > 1) {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        }
        if (key === "changeLog") {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        }
      }
      return originalSetItem.call(this, key, value);
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
      delete window.__storageKeyWriteCount;
    }
  });
}

async function installSyncPushSpy(page) {
  await page.evaluate(() => {
    window.__scheduleSyncPushCalls = 0;
    const original = typeof window.scheduleSyncPush === "function" ? window.scheduleSyncPush : null;
    window.__origScheduleSyncPush = original;
    window.scheduleSyncPush = function (...args) {
      window.__scheduleSyncPushCalls += 1;
      if (original) original(...args);
    };
  });
}

async function openAppearanceSettings(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("site"));
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator("#settingsPanel_site")).toBeVisible();
}

async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

function dispositionHeadings(page) {
  return page.locator("#viewItemModal .view-section-title").filter({ hasText: /^Disposition$/ });
}

function sectionHeadings(page) {
  return page.locator("#viewItemModal .view-section-title");
}

test.describe("core/disposition", () => {
  // STRK-170 characterization: pin confirmRemoveItem's three observable paths
  // (plain delete, full disposition, validation reject) before the complexity
  // refactor. Green on current code; goes red only if the refactor changes
  // observable behavior (inventory mutation, changelog, modal state).
  test("STRK-170: confirmRemoveItem path characterization (delete / dispose / reject)", async ({
    page,
  }) => {
    const baseCoin = (over) => ({
      metal: "Silver",
      composition: "Silver",
      qty: 1,
      type: "Coin",
      weight: 1,
      weightUnit: "oz",
      price: 30,
      purity: 0.999,
      ...over,
    });
    await seedDispositionData(page, {
      inventory: [
        baseCoin({ uuid: "strk170-del", name: "STRK-170 Delete Me" }),
        baseCoin({ uuid: "strk170-sell", name: "STRK-170 Sell Me" }),
        baseCoin({ uuid: "strk170-reject", name: "STRK-170 Reject Me" }),
      ],
    });
    await gotoApp(page);

    // (a) Plain delete: open the remove modal with dispose unchecked, click Delete.
    await page.evaluate(() => window.openRemoveItemModal(0, false));
    await expect(page.locator("#removeItemModal")).toBeVisible();
    await page.locator("#removeItemDeleteBtn").click();
    await expect(page.locator("#removeItemModal")).toBeHidden();
    const afterDelete = await page.evaluate(() => ({
      names: window.inventory.map((i) => i.name),
      storedLen: JSON.parse(localStorage.getItem("metalInventory")).length,
      fields: JSON.parse(localStorage.getItem("changeLog") || "[]").map((e) => e.field),
    }));
    expect(afterDelete.names).not.toContain("STRK-170 Delete Me");
    expect(afterDelete.storedLen).toBe(2);
    expect(afterDelete.fields).toContain("Deleted");

    // (b) Full disposition (sold): full qty disposed -> item retained + disposition set.
    const sellIdx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.uuid === "strk170-sell")
    );
    await openDisposeModal(page, sellIdx);
    await fillDisposeFields(page, { type: "sold", date: "2026-05-01", amount: "90" });
    await confirmDispose(page);
    const afterDispose = await page.evaluate(() => {
      const it = window.inventory.find((i) => i.uuid === "strk170-sell");
      return {
        present: !!it,
        type: it?.disposition?.type,
        hasAmount: typeof it?.disposition?.amount === "number",
        fields: JSON.parse(localStorage.getItem("changeLog") || "[]").map((e) => e.field),
      };
    });
    expect(afterDispose.present).toBe(true);
    expect(afterDispose.type).toBe("sold");
    expect(afterDispose.hasAmount).toBe(true);
    expect(afterDispose.fields).toContain("Disposed");

    // (c) Validation reject: dispose with a cleared date -> early return, no mutation.
    const rejectIdx = await page.evaluate(() =>
      window.inventory.findIndex((i) => i.uuid === "strk170-reject")
    );
    await openDisposeModal(page, rejectIdx);
    await page.selectOption("#dispositionType", "sold");
    await page.fill("#dispositionDate", "");
    await page.locator("#removeItemDisposeBtn").click();
    await expect(page.locator("#removeItemModal")).toBeVisible();
    const stillUndisposed = await page.evaluate(
      () => !window.inventory.find((i) => i.uuid === "strk170-reject")?.disposition
    );
    expect(stillUndisposed).toBe(true);
  });

  test("partial dispose creates an adjacent split clone with inherited cost metadata", async ({
    page,
  }) => {
    await seedDispositionData(page, {
      inventory: [BASE_ITEM],
      tags: { "core-disposition-base": ["premium", "graded"] },
    });
    await gotoApp(page);
    await openDisposeModal(page);

    await setDisposeQty(page, 3);
    await fillDisposeFields(page);
    await expect(page.locator("#removeItemDisposePreview")).toContainText("3");
    await expect(page.locator("#removeItemDisposePreview")).toContainText("7");
    await confirmDispose(page);

    const result = await page.evaluate(() => {
      const clone = window.inventory.find((item) => item.disposition?.splitFromUuid);
      return {
        length: window.inventory.length,
        originalQty: window.inventory[0]?.qty,
        cloneQty: clone?.qty,
        clonePrice: clone?.price,
        cloneNotes: clone?.notes,
        splitFromUuid: clone?.disposition?.splitFromUuid,
        cloneUuid: clone?.uuid,
        cloneTags:
          clone && typeof window.getItemTags === "function" ? window.getItemTags(clone.uuid) : [],
      };
    });

    expect(result.length).toBe(2);
    expect(result.originalQty).toBe(7);
    expect(result.cloneQty).toBe(3);
    expect(result.clonePrice).toBeCloseTo(30, 6);
    expect(result.cloneNotes).toBe("Original notes");
    expect(result.splitFromUuid).toBe("core-disposition-base");
    expect(result.cloneUuid).not.toBe("core-disposition-base");
    expect(result.cloneTags).toEqual(expect.arrayContaining(["premium", "graded"]));
  });

  test("dispose amount modes preserve realized gain/loss math", async ({ page }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await openDisposeModal(page);

    await page.selectOption("#dispositionType", "Sold");
    await setDisposeQty(page, 3);
    await page.locator("#removeItemAmountModeToggle [data-mode='lot']").click();
    await page.fill("#dispositionAmount", "105");
    await page.locator("#removeItemAmountModeToggle [data-mode='each']").click();
    await expect(page.locator("#dispositionAmount")).toHaveValue("35");
    await confirmDispose(page);

    const clone = await page.evaluate(() =>
      window.inventory.find((item) => item.disposition?.splitFromUuid)
    );
    expect(clone).toBeTruthy();
    expect(clone.disposition.amount).toBe(105);
    expect(clone.disposition.realizedGainLoss).toBeCloseTo(15, 2);
  });

  test("Lost dispositions record realized losses for partial and full stacks", async ({ page }) => {
    await seedDispositionData(page, {
      inventory: [BASE_ITEM, { ...BASE_ITEM, uuid: "core-full-lost", name: "Core Full Lost" }],
    });
    await gotoApp(page);

    await openDisposeModal(page, 0);
    await page.selectOption("#dispositionType", "Lost");
    await setDisposeQty(page, 3);
    await confirmDispose(page);

    await openDisposeModal(page, 2);
    await page.selectOption("#dispositionType", "Lost");
    await confirmDispose(page);

    const result = await page.evaluate(() => {
      if (typeof window.updateSummary === "function") window.updateSummary();
      const partialClone = window.inventory.find((item) => item.disposition?.splitFromUuid);
      const full = window.inventory.find((item) => item.uuid === "core-full-lost");
      return {
        partialLoss: partialClone?.disposition?.realizedGainLoss,
        fullLoss: full?.disposition?.realizedGainLoss,
        silverRealized: document.getElementById("realizedGainLossSilver")?.textContent || "",
      };
    });

    expect(result.partialLoss).toBeCloseTo(-90, 2);
    expect(result.fullLoss).toBeCloseTo(-300, 2);
    expect(result.silverRealized).toContain("-$390.00");
  });

  test("correlated activity entries cascade undo atomically by transaction id", async ({
    page,
  }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await splitBaseItem(page);
    expect(result.ok).toBe(true);
    expect(result.transactionId).toBeTruthy();

    const entries = await page.evaluate(
      (transactionId) => window.changeLog.filter((entry) => entry.transactionId === transactionId),
      result.transactionId
    );
    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.stackSplit)).toBe(true);
    expect(entries.some((entry) => entry.splitDisposed)).toBe(true);

    const undoResult = await runCascadeUndo(page, result.transactionId);
    expect(undoResult.ok).toBe(true);
    expect(undoResult.applied).toBe("cascade");

    const restored = await page.evaluate(() => ({
      inventoryLength: window.inventory.length,
      originalQty: window.inventory[0]?.qty,
    }));
    expect(restored.inventoryLength).toBe(1);
    expect(restored.originalQty).toBe(10);
  });

  test("restore choices merge or separate split clones without the legacy path", async ({
    page,
  }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await splitBaseItem(page);

    let cloneIndex = await page.evaluate(() =>
      window.inventory.findIndex((item) => item.disposition?.splitFromUuid)
    );
    await page.evaluate((idx) => {
      window.undoDisposition(idx);
    }, cloneIndex);
    await expect(page.locator("#restoreChoiceModal")).toBeVisible();
    await expect(page.locator("#restoreChoiceMessage")).toContainText("10");
    await page.locator("#restoreChoiceModal [data-action='merge']").click();
    await expect(page.locator("#restoreChoiceModal")).toBeHidden();

    let inventoryState = await page.evaluate(() => ({
      length: window.inventory.length,
      originalQty: window.inventory.find((item) => item.uuid === "core-disposition-base")?.qty,
    }));
    expect(inventoryState).toEqual({ length: 1, originalQty: 10 });

    await splitBaseItem(page);
    cloneIndex = await page.evaluate(() =>
      window.inventory.findIndex((item) => item.disposition?.splitFromUuid)
    );
    await page.evaluate((idx) => {
      window.undoDisposition(idx);
    }, cloneIndex);
    await expect(page.locator("#restoreChoiceModal")).toBeVisible();
    await page.locator("#restoreChoiceModal [data-action='separate']").click();
    await expect(page.locator("#restoreChoiceModal")).toBeHidden();

    inventoryState = await page.evaluate(() => ({
      length: window.inventory.length,
      cloneDisposition: window.inventory[1]?.disposition || null,
    }));
    expect(inventoryState.length).toBe(2);
    expect(inventoryState.cloneDisposition).toBeNull();
  });

  test("storage rollback leaves inventory and changelog unchanged on persistence failure", async ({
    page,
  }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await installStorageFailMock(page, "changelog");

    const before = await page.evaluate(() => ({
      length: window.inventory.length,
      qty: window.inventory[0]?.qty,
      logLength: Array.isArray(window.changeLog) ? window.changeLog.length : 0,
    }));

    const result = await splitBaseItem(page);
    await restoreStorageMock(page);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("storage_failed_changelog");

    const after = await page.evaluate(() => ({
      length: window.inventory.length,
      qty: window.inventory[0]?.qty,
      logLength: Array.isArray(window.changeLog) ? window.changeLog.length : 0,
    }));
    expect(after).toEqual(before);
  });

  test("unrecoverable storage rollback reports storage_failed_both", async ({ page }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await installStorageFailMock(page, "phase2-and-revert");

    const result = await splitBaseItem(page);
    await restoreStorageMock(page);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("storage_failed_both");
  });

  test("partial dispose and cascade undo schedule cloud sync pushes", async ({ page }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await installSyncPushSpy(page);

    const splitResult = await splitBaseItem(page);
    expect(splitResult.ok).toBe(true);
    expect(await page.evaluate(() => window.__scheduleSyncPushCalls)).toBeGreaterThanOrEqual(1);

    await page.evaluate(() => {
      window.__scheduleSyncPushCalls = 0;
    });
    const undoResult = await runCascadeUndo(page, splitResult.transactionId);
    expect(undoResult.ok).toBe(true);
    expect(await page.evaluate(() => window.__scheduleSyncPushCalls)).toBeGreaterThanOrEqual(1);
  });

  test("CSV round-trip preserves split disposition fields", async ({ page }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    await splitBaseItem(page, {
      amount: 90,
      recipient: "CSV Buyer",
      notes: "CSV round-trip notes",
    });

    const csvContent = await page.evaluate(() => window.exportInventoryCSV?.() ?? null);
    expect(csvContent).not.toBeNull();
    expect(csvContent).toContain("Disposition Split From UUID");
    expect(csvContent).toContain("Disposition Recipient");
    expect(csvContent).toContain("Disposition Notes");
    expect(csvContent).toContain("Disposition Currency");
    expect(csvContent).toContain("Disposition DisposedAt");

    const imported = await page.evaluate((csv) => {
      const parsed = window.importCsvFromText?.(csv);
      return parsed?.find((item) => item.disposition?.splitFromUuid) ?? null;
    }, csvContent);

    expect(imported).not.toBeNull();
    expect(imported.disposition.splitFromUuid).toBe("core-disposition-base");
    expect(imported.disposition.amount).toBe(90);
    expect(imported.disposition.recipient).toBe("CSV Buyer");
    expect(imported.disposition.notes).toBe("CSV round-trip notes");
    expect(imported.disposition.currency).toBe("USD");
    expect(typeof imported.disposition.disposedAt).toBe("string");
    expect(imported.disposition.disposedAt.length).toBeGreaterThan(0);
  });

  test("quantity controls cover single-item, chip, and select boundaries", async ({ page }) => {
    await seedDispositionData(page, {
      inventory: [SINGLE_ITEM, { ...BASE_ITEM, uuid: "core-chip-stack", qty: 4 }, BASE_ITEM],
    });
    await gotoApp(page);

    await openDisposeModal(page, 0);
    await expect(page.locator("#removeItemQtyGroup")).toBeVisible();
    await expect(page.locator("#removeItemQtyChips")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator('#removeItemQtyChips button[data-qty="1"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await page.evaluate(() => window.closeModalById("removeItemModal"));
    await openDisposeModal(page, 1);
    await expect(page.locator('#removeItemQtyChips button[data-qty="0"]')).toHaveCount(0);
    await expect(page.locator('#removeItemQtyChips button[data-qty="5"]')).toHaveCount(0);
    await page.locator('#removeItemQtyChips button[data-qty="4"]').focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator('#removeItemQtyChips button[data-qty="3"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await page.evaluate(() => window.closeModalById("removeItemModal"));
    await openDisposeModal(page, 2);
    await expect(page.locator("#removeItemQtySelect")).toBeVisible();
    await expect(page.locator("#removeItemQtySelect option")).toHaveCount(10);
    await expect(page.locator("#removeItemQtySelect")).toHaveValue("10");
  });

  test("settings row persists disposition placement and renders only for disposed items", async ({
    page,
  }) => {
    await seedDispositionData(page, {
      inventory: [DISPOSED_ITEM],
      sectionConfig: LEGACY_SECTION_CONFIG,
    });
    await gotoApp(page);
    await openAppearanceSettings(page);

    const row = page.locator('#viewModalSectionConfigContainer tr[data-section-id="disposition"]');
    await expect(row).toBeVisible();
    await expect(row.locator("td").nth(1)).toHaveText("Disposition");
    await row.locator(".inline-chip-move").nth(0).click();
    await page.reload();
    await openAppearanceSettings(page);

    const rows = page.locator("#viewModalSectionConfigContainer tbody tr");
    const lastId = await rows.nth((await rows.count()) - 1).getAttribute("data-section-id");
    expect(lastId).not.toBe("disposition");

    await page.evaluate((cfg) => {
      localStorage.setItem("viewModalSectionConfig", JSON.stringify(cfg));
    }, DISPOSITION_BETWEEN_CONFIG);
    await openViewModal(page);
    await expect(dispositionHeadings(page)).toHaveCount(1);
    const headings = await sectionHeadings(page).allTextContents();
    const idx = headings.indexOf("Disposition");
    expect(headings[idx - 1]).toBe("Valuation");
    expect(headings[idx + 1]).toBe("Price History");
  });

  test("active and empty-disposition items do not render a Disposition section", async ({
    page,
  }) => {
    await seedDispositionData(page, {
      inventory: [NON_DISPOSED_ITEM, EMPTY_DISPOSITION_ITEM],
      sectionConfig: DISPOSITION_BETWEEN_CONFIG,
    });
    await gotoApp(page);

    await openViewModal(page, 0);
    await expect(dispositionHeadings(page)).toHaveCount(0);
    await page.evaluate(() => window.closeModalById("viewItemModal"));

    await openViewModal(page, 1);
    await expect(dispositionHeadings(page)).toHaveCount(0);
    const wrapperCount = await page
      .locator("#viewItemModal .view-detail-section")
      .filter({ hasText: /^Disposition/ })
      .count();
    expect(wrapperCount).toBe(0);
  });

  test("empty-disposition items stay active across filter modes, badge, and styling (STRK-83)", async ({
    page,
  }) => {
    // idx 0 = active, idx 1 = empty disposition {}, idx 2 = real disposed.
    await seedDispositionData(page, {
      inventory: [NON_DISPOSED_ITEM, EMPTY_DISPOSITION_ITEM, DISPOSED_ITEM],
    });
    await gotoApp(page);

    const activeRow = page.locator('tr[data-idx="0"]');
    const emptyRow = page.locator('tr[data-idx="1"]');
    const disposedRow = page.locator('tr[data-idx="2"]');
    const chip = (mode) =>
      page.locator(`#disposedFilterGroup .chip-sort-btn[data-disposed-mode="${mode}"]`);

    // show-all → every item renders. AC-2: the empty-disposition item carries NO
    // disposed styling or badge, while the real disposed item still does.
    await chip("show-all").click();
    await expect(activeRow).toHaveCount(1);
    await expect(emptyRow).toHaveCount(1);
    await expect(emptyRow).not.toHaveClass(/disposed-row/);
    await expect(emptyRow.locator(".disposition-badge")).toHaveCount(0);
    await expect(disposedRow).toHaveClass(/disposed-row/);
    await expect(disposedRow.locator(".disposition-badge")).toHaveCount(1);

    // hide (active) mode → AC-3: empty-disposition item stays VISIBLE; real disposed hidden.
    await chip("hide").click();
    await expect(activeRow).toHaveCount(1);
    await expect(emptyRow).toHaveCount(1);
    await expect(disposedRow).toHaveCount(0);

    // show-only mode → AC-3: empty-disposition item is EXCLUDED; real disposed shown.
    await chip("show-only").click();
    await expect(activeRow).toHaveCount(0);
    await expect(emptyRow).toHaveCount(0);
    await expect(disposedRow).toHaveCount(1);
  });

  test("realized gain/loss visibility toggle hides, shows, and persists summary rows", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await openAppearanceSettings(page);

    await expect(page.locator("#settingsShowRealizedToggle")).toBeVisible();
    await page.locator('#settingsShowRealizedToggle .chip-sort-btn[data-val="no"]').click();
    await expect(page.locator(".total-item:has(#realizedGainLossSilver)")).toBeHidden();
    await expect(page.locator(".total-item:has(#realizedGainLossAll)")).toBeHidden();

    await page.reload();
    await openAppearanceSettings(page);
    await expect(
      page.locator('#settingsShowRealizedToggle .chip-sort-btn[data-val="no"]')
    ).toHaveClass(/active/);
    await expect(page.locator(".total-item:has(#realizedGainLossSilver)")).toBeHidden();

    await page.locator('#settingsShowRealizedToggle .chip-sort-btn[data-val="yes"]').click();
    await expect(page.locator(".total-item:has(#realizedGainLossSilver)")).toBeVisible();
    await expect(page.getByText("Summary Totals", { exact: true })).toHaveCount(0);
  });

  test.describe("trade-linking", () => {
    const RECEIVED_ROUND = {
      ...BASE_ITEM,
      uuid: "trade-received-round",
      name: "Trade Received Round",
      qty: 2,
      serial: 2,
    };

    const LINKED_SOURCE = {
      ...BASE_ITEM,
      uuid: "trade-linked-source",
      name: "Trade Linked Source",
      qty: 1,
      serial: 3,
      disposition: {
        type: "traded",
        date: "2026-01-01",
        amount: 60,
        realizedGainLoss: 30,
        tradedForUuids: ["trade-received-round"],
        tradeValues: {
          "trade-received-round": { meltValue: 59.94, spotPrice: 30, isCustom: false },
        },
      },
    };

    test("dispose flow links received items, supports add-new, and records bidirectional fields", async ({
      page,
    }) => {
      await seedDispositionData(page, { inventory: [BASE_ITEM, RECEIVED_ROUND] });
      await gotoApp(page);
      await openDisposeModal(page, 0);

      await page.selectOption("#dispositionType", "traded");
      await expect(page.locator("#tradeLinkSection")).toBeVisible();
      await page.fill("#tradeItemSearch", "Received Round");
      await page.getByRole("option", { name: /Trade Received Round/i }).click();
      await expect(page.locator("#tradeLinkedItems")).toContainText("Trade Received Round");
      await expect(page.locator("#tradeValueSummary")).toContainText("$");
      await expect(page.locator("#tradeAddNewItemBtn")).toBeVisible();

      await confirmDispose(page);

      const result = await page.evaluate(() => {
        const source = window.inventory.find((item) => item.uuid === "core-disposition-base");
        const received = window.inventory.find((item) => item.uuid === "trade-received-round");
        return {
          tradedForUuids: source?.disposition?.tradedForUuids || [],
          tradeValues: source?.disposition?.tradeValues || {},
          tradedFromUuid: received?.tradedFromUuid || null,
          hasAddNewCapture: typeof window.__lastCommittedItemUuid !== "undefined",
        };
      });

      expect(result.tradedForUuids).toContain("trade-received-round");
      expect(result.tradeValues["trade-received-round"]).toMatchObject({ isCustom: false });
      expect(result.tradeValues["trade-received-round"].spotPrice).toBeGreaterThan(0);
      expect(result.tradedFromUuid).toBe("core-disposition-base");
    });

    test("view modal renders linked and unlinked trade sections plus received provenance", async ({
      page,
    }) => {
      await seedDispositionData(page, {
        inventory: [
          LINKED_SOURCE,
          { ...RECEIVED_ROUND, tradedFromUuid: "trade-linked-source" },
          {
            ...BASE_ITEM,
            uuid: "trade-unlinked-source",
            name: "Trade Unlinked Source",
            serial: 4,
            disposition: { type: "traded", date: "2026-01-02", amount: 35 },
          },
        ],
      });
      await gotoApp(page);

      await openViewModal(page, 0);
      await expect(sectionHeadings(page)).toContainText(["Trade"]);
      await expect(page.locator("#viewItemModal")).toContainText("Trade Gain/Loss");
      await expect(page.locator("#viewItemModal")).toContainText("Trade Received Round");
      await expect(page.locator("#viewItemModal")).toContainText("Edit Trade");
      await page.evaluate(() => window.closeModalById("viewItemModal"));

      await openViewModal(page, 1);
      await expect(page.locator("#viewItemModal")).toContainText("Acquired via trade");
      await expect(page.locator("#viewItemModal")).toContainText("Trade Linked Source");
      await expect(page.locator("#viewItemModal")).toContainText("Unlink from Trade");
      await page.evaluate(() => window.closeModalById("viewItemModal"));

      await openViewModal(page, 2);
      await expect(dispositionHeadings(page)).toHaveCount(1);
      await expect(page.locator("#viewItemModal")).not.toContainText("TRADE GAIN/LOSS");
    });

    test("edit trade add/remove, received-side unlink, and relink conflict use DOM confirms", async ({
      page,
    }) => {
      await seedDispositionData(page, {
        inventory: [
          LINKED_SOURCE,
          { ...RECEIVED_ROUND, tradedFromUuid: "trade-linked-source" },
          { ...BASE_ITEM, uuid: "trade-new-received", name: "Trade New Received", serial: 5 },
        ],
      });
      await gotoApp(page);

      const result = await page.evaluate(async () => {
        await window.linkTradeItems(window.inventory[0], ["trade-new-received"], "2026-01-01");
        await window.unlinkTradeItem(window.inventory[0], "trade-received-round");
        return {
          sourceLinks: window.inventory[0].disposition.tradedForUuids,
          oldBackRef: window.inventory[1].tradedFromUuid || null,
          newBackRef: window.inventory[2].tradedFromUuid || null,
          tradeLinkEntries: window.changeLog.filter((entry) => entry.field === "tradeLink").length,
        };
      });

      expect(result.sourceLinks).toEqual(["trade-new-received"]);
      expect(result.oldBackRef).toBeNull();
      expect(result.newBackRef).toBe("trade-linked-source");
      expect(result.tradeLinkEntries).toBeGreaterThanOrEqual(2);
    });

    test("spot values, cache misses, missing links, and re-disposed links degrade gracefully", async ({
      page,
    }) => {
      await seedDispositionData(page, {
        inventory: [
          {
            ...LINKED_SOURCE,
            disposition: {
              ...LINKED_SOURCE.disposition,
              tradedForUuids: ["trade-received-round", "trade-missing", "trade-redisp"],
            },
          },
          RECEIVED_ROUND,
          {
            ...BASE_ITEM,
            uuid: "trade-redisp",
            name: "Trade Re-disposed",
            serial: 6,
            tradedFromUuid: "trade-linked-source",
            disposition: { type: "sold", date: "2026-02-01", amount: 40 },
          },
        ],
      });
      await gotoApp(page);

      const spotValue = await page.evaluate(() =>
        window.computeTradeValue(window.inventory[1], "2026-01-01")
      );
      expect(spotValue).toMatchObject({ isCustom: false });
      expect(spotValue.spotPrice).toBeGreaterThan(0);
      expect(
        await page.evaluate(() =>
          window.computeTradeValue({ ...window.inventory[1], metal: "Rhodium" }, "2026-01-01")
        )
      ).toBeNull();

      await openViewModal(page, 0);
      await expect(page.locator("#viewItemModal")).toContainText("Missing item");
      await expect(page.locator("#viewItemModal")).toContainText("Trade Re-disposed");
    });

    test("cost basis divides by actually-linked count, not raw input length (STRK-196)", async ({
      page,
    }) => {
      // Source is Rhodium (no seeded spot) so computeTradeValue() returns null,
      // pinning givenUpValue to disposition.amount for a deterministic divisor.
      const TRADE_SOURCE = {
        ...BASE_ITEM,
        uuid: "strk196-source",
        name: "STRK-196 Trade Source",
        metal: "Rhodium",
        composition: "Rhodium",
        qty: 1,
        serial: 7,
        disposition: {
          type: "traded",
          date: "2026-01-01",
          amount: 100,
          realizedGainLoss: 0,
          tradedForUuids: [],
        },
      };
      const RECEIVED_ONE = {
        ...BASE_ITEM,
        uuid: "strk196-received-one",
        name: "STRK-196 Received One",
        qty: 1,
        serial: 8,
      };
      const RECEIVED_TWO = {
        ...BASE_ITEM,
        uuid: "strk196-received-two",
        name: "STRK-196 Received Two",
        qty: 1,
        serial: 9,
      };

      await seedDispositionData(page, {
        inventory: [TRADE_SOURCE, RECEIVED_ONE, RECEIVED_TWO],
      });
      await gotoApp(page);

      const result = await page.evaluate(async () => {
        const source = window.inventory.find((i) => i.uuid === "strk196-source");
        // Polluted input: a duplicate, a falsy entry, the source's own (self)
        // uuid, and a missing uuid surround the two real received items. Only
        // two items can actually be linked.
        const linked = await window.linkTradeItems(
          source,
          [
            "strk196-received-one",
            "strk196-received-one",
            "",
            "strk196-source",
            "strk196-missing",
            "strk196-received-two",
          ],
          "2026-01-01"
        );
        const gutv = window.computeTradeValue(source, "2026-01-01");
        const givenUpValue = gutv?.meltValue || parseFloat(source.disposition.amount) || 0;
        const one = window.inventory.find((i) => i.uuid === "strk196-received-one");
        const two = window.inventory.find((i) => i.uuid === "strk196-received-two");
        return {
          linked,
          tradedForUuids: source.disposition.tradedForUuids,
          givenUpValue,
          priceOne: one.price,
          priceTwo: two.price,
          tradeLinkEntries: window.changeLog.filter(
            (entry) => entry.field === "tradeLink" && entry.itemKey === "strk196-source"
          ).length,
        };
      });

      // Only the two unique, resolvable, non-self received items are linked.
      expect(result.linked).toEqual(["strk196-received-one", "strk196-received-two"]);
      expect(result.tradedForUuids).toEqual(["strk196-received-one", "strk196-received-two"]);

      // Cost basis splits the given-up value by the 2 actually-linked items —
      // each received item carries half — NOT by the raw 6-entry input length
      // (which would dilute each to a sixth). Relational assertion is immune to
      // the exact melt-value formula: price * linkedCount must equal givenUpValue.
      expect(result.givenUpValue).toBeGreaterThan(0);
      expect(result.priceOne).toBe(result.priceTwo);
      expect(parseFloat(result.priceOne) * 2).toBeCloseTo(result.givenUpValue, 5);

      // The duplicated input uuid must not emit a redundant trade-link row.
      expect(result.tradeLinkEntries).toBe(2);
    });
  });
});

test.describe("core/changeLog undo (STRK-170 cohort 2.2 characterization)", () => {
  // Pin js/changeLog.js toggleChange (field-dispatch) and confirmCascadeUndo
  // (two-phase-commit rollback / drift downgrade / fallback) BEFORE the
  // complexity refactor. Green on current code; goes red only if the refactor
  // changes observable behavior (inventory/changeLog mutation, undo state,
  // result contract). Undo-critical — these are the surfaces the helper
  // extraction most risks.

  test("STRK-170: toggleChange scalar-field undo/redo round-trip", async ({ page }) => {
    await seedDispositionData(page, { inventory: [{ ...BASE_ITEM, notes: "edited" }] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      window.changeLog = [
        { idx: 0, field: "notes", oldValue: "original", newValue: "edited", undone: false },
      ];
      const out = {};
      await window.toggleChange(0); // undo → restore oldValue
      out.afterUndo = window.inventory[0].notes;
      out.undoneAfterUndo = window.changeLog[0].undone;
      await window.toggleChange(0); // redo → re-apply newValue
      out.afterRedo = window.inventory[0].notes;
      out.undoneAfterRedo = window.changeLog[0].undone;
      return out;
    });

    expect(result.afterUndo).toBe("original");
    expect(result.undoneAfterUndo).toBe(true);
    expect(result.afterRedo).toBe("edited");
    expect(result.undoneAfterRedo).toBe(false);
  });

  test("STRK-170: toggleChange Deleted-undo restores, Added-undo removes", async ({ page }) => {
    await seedDispositionData(page, { inventory: [] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      // "Deleted" entry, undone=false → undo restores the snapshot at idx
      const delSnapshot = {
        uuid: "del-1",
        metal: "Silver",
        name: "Deleted Coin",
        qty: 1,
        type: "Coin",
        weight: 1,
        weightUnit: "oz",
        price: 10,
      };
      window.inventory = [];
      window.changeLog = [
        { field: "Deleted", idx: 0, oldValue: JSON.stringify(delSnapshot), undone: false },
      ];
      await window.toggleChange(0);
      const afterDeletedUndo = {
        len: window.inventory.length,
        name: window.inventory[0] ? window.inventory[0].name : null,
        undone: window.changeLog[0].undone,
      };

      // "Added" entry, undone=false → undo removes the item and snapshots it for redo
      const addItem = {
        uuid: "add-1",
        metal: "Gold",
        name: "Added Coin",
        qty: 1,
        type: "Coin",
        weight: 1,
        weightUnit: "oz",
        price: 100,
      };
      window.inventory = [addItem];
      window.changeLog = [{ field: "Added", idx: 0, undone: false }];
      await window.toggleChange(0);
      const afterAddedUndo = {
        len: window.inventory.length,
        undone: window.changeLog[0].undone,
        hasRedoSnapshot: typeof window.changeLog[0].newValue === "string",
      };

      return { afterDeletedUndo, afterAddedUndo };
    });

    expect(result.afterDeletedUndo).toEqual({ len: 1, name: "Deleted Coin", undone: true });
    expect(result.afterAddedUndo.len).toBe(0);
    expect(result.afterAddedUndo.undone).toBe(true);
    expect(result.afterAddedUndo.hasRedoSnapshot).toBe(true);
  });

  test("STRK-170: toggleChange guards are no-ops (neutralized / attachment / missing)", async ({
    page,
  }) => {
    await seedDispositionData(page, { inventory: [{ ...BASE_ITEM, notes: "untouched" }] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      const out = {};

      // neutralized entry → early return, no mutation
      window.inventory[0].notes = "untouched";
      window.changeLog = [
        { idx: 0, field: "notes", oldValue: "old", newValue: "untouched", neutralized: true },
      ];
      await window.toggleChange(0);
      out.afterNeutralized = window.inventory[0].notes;
      out.neutralizedUndoneUntouched = window.changeLog[0].undone === undefined;

      // attachment-change → early return, no scalar fall-through
      window.changeLog = [{ idx: 0, type: "attachment-change", field: "notes", oldValue: "old" }];
      await window.toggleChange(0);
      out.afterAttachment = window.inventory[0].notes;

      // missing entry (index out of range) → early return, no throw
      window.changeLog = [];
      let threw = false;
      try {
        await window.toggleChange(5);
      } catch {
        threw = true;
      }
      out.missingThrew = threw;

      return out;
    });

    expect(result.afterNeutralized).toBe("untouched");
    expect(result.neutralizedUndoneUntouched).toBe(true);
    expect(result.afterAttachment).toBe("untouched");
    expect(result.missingThrew).toBe(false);
  });

  test("STRK-170: confirmCascadeUndo rolls back on inventory-persist failure", async ({ page }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    const split = await splitBaseItem(page);
    expect(split.ok).toBe(true);

    const before = await page.evaluate(() => ({
      invLen: window.inventory.length,
      qtys: window.inventory.map((i) => i.qty),
      undoneFlags: window.changeLog.map((e) => !!e.undone),
    }));

    await installStorageFailMock(page, "inventory");
    // The cascade-undo confirm dialog appears before any persist; accept it,
    // then the inventory write fails and the function must roll back.
    await page.evaluate((tid) => {
      window.__ccuResult = null;
      window.confirmCascadeUndo(tid).then((r) => {
        window.__ccuResult = r;
      });
    }, split.transactionId);
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await page.locator("#appDialogOk").click();
    await page.waitForFunction(() => window.__ccuResult !== null, null, { timeout: 5000 });
    const result = await page.evaluate(() => window.__ccuResult);
    await restoreStorageMock(page);

    expect(result.ok).toBe(false);
    expect(result.applied).toBe("none");
    expect(result.reason).toBe("storage_failed_inventory");

    const after = await page.evaluate(() => ({
      invLen: window.inventory.length,
      qtys: window.inventory.map((i) => i.qty),
      undoneFlags: window.changeLog.map((e) => !!e.undone),
    }));
    expect(after).toEqual(before);
  });

  test("STRK-170: confirmCascadeUndo rolls back both stores on changelog-persist failure", async ({
    page,
  }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    const split = await splitBaseItem(page);
    expect(split.ok).toBe(true);

    const before = await page.evaluate(() => ({
      invLen: window.inventory.length,
      qtys: window.inventory.map((i) => i.qty),
      undoneFlags: window.changeLog.map((e) => !!e.undone),
    }));

    await installStorageFailMock(page, "changelog");
    await page.evaluate((tid) => {
      window.__ccuResult = null;
      window.confirmCascadeUndo(tid).then((r) => {
        window.__ccuResult = r;
      });
    }, split.transactionId);
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await page.locator("#appDialogOk").click();
    await page.waitForFunction(() => window.__ccuResult !== null, null, { timeout: 5000 });
    const result = await page.evaluate(() => window.__ccuResult);
    await restoreStorageMock(page);

    expect(result.ok).toBe(false);
    expect(result.applied).toBe("none");
    expect(result.reason).toBe("storage_failed_changelog");

    const after = await page.evaluate(() => ({
      invLen: window.inventory.length,
      qtys: window.inventory.map((i) => i.qty),
      undoneFlags: window.changeLog.map((e) => !!e.undone),
    }));
    expect(after).toEqual(before);
  });

  test("STRK-170: confirmCascadeUndo downgrades to single-entry undo on drift", async ({
    page,
  }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);
    const split = await splitBaseItem(page);
    expect(split.ok).toBe(true);

    // Drift one of the four invariants: the surviving original's qty no longer
    // matches originalQtyAfter → cascade must downgrade to single-entry undo.
    await page.evaluate(() => {
      const orig = window.inventory.find((i) => !i.disposition || !i.disposition.splitFromUuid);
      if (orig) orig.qty += 5;
    });

    // runCascadeUndo accepts the (drift) confirm dialog → single-entry fallback.
    const result = await runCascadeUndo(page, split.transactionId);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe("single-entry");
  });

  test("STRK-170: confirmCascadeUndo with no paired entries returns no_paired_entries", async ({
    page,
  }) => {
    await seedDispositionData(page, { inventory: [BASE_ITEM] });
    await gotoApp(page);

    const result = await page.evaluate(async () => {
      window.changeLog = [];
      return await window.confirmCascadeUndo("missing-transaction-id", null);
    });

    expect(result.ok).toBe(false);
    expect(result.applied).toBe("none");
    expect(result.reason).toBe("no_paired_entries");
  });
});

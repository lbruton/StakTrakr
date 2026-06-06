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

    const emptyRow = page.locator('tr[data-idx="1"]');
    const disposedRow = page.locator('tr[data-idx="2"]');
    const chip = (mode) =>
      page.locator(`#disposedFilterGroup .chip-sort-btn[data-disposed-mode="${mode}"]`);

    // show-all → every item renders. AC-2: the empty-disposition item carries NO
    // disposed styling or badge, while the real disposed item still does.
    await chip("show-all").click();
    await expect(emptyRow).toHaveCount(1);
    await expect(emptyRow).not.toHaveClass(/disposed-row/);
    await expect(emptyRow.locator(".disposition-badge")).toHaveCount(0);
    await expect(disposedRow).toHaveClass(/disposed-row/);
    await expect(disposedRow.locator(".disposition-badge")).toHaveCount(1);

    // hide (active) mode → AC-3: empty-disposition item stays VISIBLE; real disposed hidden.
    await chip("hide").click();
    await expect(emptyRow).toHaveCount(1);
    await expect(disposedRow).toHaveCount(0);

    // show-only mode → AC-3: empty-disposition item is EXCLUDED; real disposed shown.
    await chip("show-only").click();
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
  });
});

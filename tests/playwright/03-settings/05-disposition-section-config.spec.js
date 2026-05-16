import { test, expect } from "../helpers/mocks/extended-test.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ITEM = {
  uuid: "strk73-base-item",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-73 Base ASE",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 0,
  date: "2026-01-01",
  purchaseLocation: "LCS",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 28,
  premiumPerOz: 2,
  totalPremium: 2,
  purity: 0.999,
  numistaId: "",
  serial: 1,
};

/** Item with a fully-populated disposition — should render the Disposition section. */
const DISPOSED_ITEM = {
  ...BASE_ITEM,
  uuid: "strk73-disposed-item",
  name: "STRK-73 Disposed ASE",
  disposition: { type: "Sold", date: "2026-05-01", amount: 950, realizedGainLoss: 650 },
};

/** Item with no disposition — must never render the Disposition section. */
const NON_DISPOSED_ITEM = {
  ...BASE_ITEM,
  uuid: "strk73-non-disposed-item",
  name: "STRK-73 Non-Disposed ASE",
};

/** Item with an empty disposition object — must not render the section (AC-6). */
const EMPTY_DISPOSITION_ITEM = {
  ...BASE_ITEM,
  uuid: "strk73-empty-disposition-item",
  name: "STRK-73 Empty Disposition ASE",
  disposition: {},
};

/**
 * Simulates a legacy user who saved viewModalSectionConfig before STRK-73 shipped.
 * Nine entries — no "disposition" key. _loadSectionConfig() should append it last.
 */
const LEGACY_9_CONFIG = [
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

/**
 * Ten-entry config with disposition placed between Valuation and Price History.
 * Used to test AC-3 — configured placement, not hardcoded last.
 */
const CONFIG_DISPOSITION_BETWEEN = [
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedData(page, { inventory, sectionConfig = null } = {}) {
  await page.addInitScript(
    ({ items, cfg }) => {
      localStorage.setItem("metalInventory", JSON.stringify(items));
      localStorage.setItem("itemTags", JSON.stringify({}));
      localStorage.setItem("cardViewStyle", "D");
      localStorage.setItem("displayCurrency", JSON.stringify("USD"));
      localStorage.setItem("exchangeRates", JSON.stringify({ EUR: 0.9 }));
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
      // Guard against overwriting on reload: only seed if no saved value exists yet.
      // Tests that verify "persists after reload" rely on the click-saved value surviving.
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
    { items: inventory, cfg: sectionConfig }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.showViewModal === "function" &&
      typeof window.editItem === "function" &&
      typeof window.getViewModalSectionConfig === "function" &&
      Array.isArray(window.inventory) &&
      window.inventory.length > 0
  );
  await page.waitForTimeout(300);
}

async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

async function openAppearanceSettings(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("site"));
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator("#settingsPanel_site")).toBeVisible();
  await expect(page.locator("#viewModalSectionConfigContainer")).toBeVisible();
}

/** All .view-section-title elements rendered inside the view item modal. */
function sectionHeadings(page) {
  return page.locator("#viewItemModal .view-section-title");
}

/** Locator matching .view-section-title elements whose full text is exactly "Disposition". */
function dispositionHeadings(page) {
  return page.locator("#viewItemModal .view-section-title").filter({ hasText: /^Disposition$/ });
}

// ---------------------------------------------------------------------------
// Tests — B.2: settings row, reorder controls, persisted order (AC-1, AC-2, AC-5)
// ---------------------------------------------------------------------------

test.describe("03-settings/05-disposition-section-config — STRK-73", () => {
  test("5.1 (AC-1) — Disposition row appears in Item Detail Modal settings after legacy 9-entry seed", async ({
    page,
  }) => {
    await seedData(page, { inventory: [NON_DISPOSED_ITEM], sectionConfig: LEGACY_9_CONFIG });
    await gotoApp(page);
    await openAppearanceSettings(page);

    const row = page.locator('#viewModalSectionConfigContainer tr[data-section-id="disposition"]');
    await expect(row).toBeVisible();
    await expect(row.locator("td").nth(1)).toHaveText("Disposition");
  });

  test("5.2 (AC-2) — Disposition at 10-entry boundary: down-arrow disabled, up-arrow enabled", async ({
    page,
  }) => {
    await seedData(page, { inventory: [NON_DISPOSED_ITEM], sectionConfig: LEGACY_9_CONFIG });
    await gotoApp(page);
    await openAppearanceSettings(page);

    const row = page.locator('#viewModalSectionConfigContainer tr[data-section-id="disposition"]');
    const moveButtons = row.locator(".inline-chip-move");

    await expect(moveButtons).toHaveCount(2);
    await expect(moveButtons.nth(0)).not.toBeDisabled(); // up — not first row
    await expect(moveButtons.nth(1)).toBeDisabled(); // down — last of 10 sortable rows
  });

  test("5.3 (AC-2, AC-5) — moving Disposition up persists its position after reload", async ({
    page,
  }) => {
    await seedData(page, { inventory: [NON_DISPOSED_ITEM], sectionConfig: LEGACY_9_CONFIG });
    await gotoApp(page);
    await openAppearanceSettings(page);

    // Move disposition off the last position
    const row = page.locator('#viewModalSectionConfigContainer tr[data-section-id="disposition"]');
    await row.locator(".inline-chip-move").nth(0).click();

    // After re-render the down-arrow is now enabled (no longer last)
    const movedRow = page.locator(
      '#viewModalSectionConfigContainer tr[data-section-id="disposition"]'
    );
    await expect(movedRow.locator(".inline-chip-move").nth(1)).not.toBeDisabled();

    // Persist across reload
    await page.reload();
    await openAppearanceSettings(page);

    const allRows = page.locator("#viewModalSectionConfigContainer tbody tr");
    const total = await allRows.count();
    const lastId = await allRows.nth(total - 1).getAttribute("data-section-id");
    expect(lastId).not.toBe("disposition");
  });

  // ---------------------------------------------------------------------------
  // B.3: disposed item — configured placement (AC-3)
  // ---------------------------------------------------------------------------

  test("5.4 (AC-3) — disposed item renders exactly one Disposition section at configured position", async ({
    page,
  }) => {
    await seedData(page, { inventory: [DISPOSED_ITEM], sectionConfig: CONFIG_DISPOSITION_BETWEEN });
    await gotoApp(page);
    await openViewModal(page, 0);

    // Exactly one Disposition heading — catches any double-render from the deleted STAK-72 block
    await expect(dispositionHeadings(page)).toHaveCount(1);

    // Verify configured position: after "Valuation", before "Price History"
    const texts = await sectionHeadings(page).allTextContents();
    const idx = texts.indexOf("Disposition");
    expect(idx).toBeGreaterThan(-1);
    expect(texts[idx - 1]).toBe("Valuation");
    expect(texts[idx + 1]).toBe("Price History");
  });

  // ---------------------------------------------------------------------------
  // B.4: non-disposed and empty-object absence (AC-4, AC-6)
  // ---------------------------------------------------------------------------

  test("5.5 (AC-4) — non-disposed item renders zero Disposition sections regardless of config", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [NON_DISPOSED_ITEM],
      sectionConfig: CONFIG_DISPOSITION_BETWEEN,
    });
    await gotoApp(page);
    await openViewModal(page, 0);

    await expect(dispositionHeadings(page)).toHaveCount(0);
  });

  test("5.6 (AC-6) — item with empty disposition object renders zero Disposition sections (DOM absent, not CSS-hidden)", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [EMPTY_DISPOSITION_ITEM],
      sectionConfig: CONFIG_DISPOSITION_BETWEEN,
    });
    await gotoApp(page);
    await openViewModal(page, 0);

    // Title must be absent from DOM entirely
    await expect(dispositionHeadings(page)).toHaveCount(0);

    // Verify the .view-detail-section wrapper is also absent (not just title hidden)
    const sectionCount = await page
      .locator("#viewItemModal .view-detail-section")
      .filter({ hasText: /^Disposition/ })
      .count();
    expect(sectionCount).toBe(0);
  });
});

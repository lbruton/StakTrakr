import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const seedApiState = async (page, opts = {}) => {
  await page.addInitScript((data) => {
    if (data.spotPricingSource !== undefined) {
      localStorage.setItem("spotPricingSource", JSON.stringify(data.spotPricingSource));
    }
    if (data.metalApiConfig !== undefined) {
      localStorage.setItem("metalApiConfig", JSON.stringify(data.metalApiConfig));
    }
  }, opts);
};

const openApiSettings = async (page) => {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("api"));
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator("#settingsPanel_api")).toBeVisible();
};

const openSettingsSection = async (page, section) => {
  await page.waitForFunction(
    () =>
      typeof window.showSettingsModal === "function" &&
      typeof window.switchSettingsSection === "function"
  );
  await page.evaluate((target) => {
    window.showSettingsModal(target);
    window.switchSettingsSection(target);
  }, section);
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator(`#settingsPanel_${section}`)).toBeVisible();
};

const readSpotPricingSource = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("spotPricingSource");
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  });

const confirmProviderSwitch = async (page, label) => {
  const dialog = page.locator("#appDialogModal");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(label);
  await dialog.locator("#appDialogOk").click();
  await expect(dialog).toBeHidden();
};

// STRK-161 — selectors for the four spot-card ratio chips. The chip lives inside
// the per-metal spot card; presence/absence is the DOM-level assertion (AC-7/11/12).
const SPOT_RATIO_CHIP = ".spot-card[data-metal] .spot-ratio-chip";
const goldChip = (page) => page.locator('.spot-card[data-metal="gold"] .spot-ratio-chip');
const nonGoldChips = (page) =>
  page.locator(
    '.spot-card[data-metal="silver"] .spot-ratio-chip, ' +
      '.spot-card[data-metal="platinum"] .spot-ratio-chip, ' +
      '.spot-card[data-metal="palladium"] .spot-ratio-chip'
  );

// Seed valid spot prices + a fresh goldback G1 rate so all four chips are
// eligible to render, then drive the idempotent render choke point. Goldback
// pricing mode defaults to a non-`off` source via gb_source so the gold chip
// is eligible (AC-4 gating handled by renderRatioChips itself).
const seedRatioState = async (page, gbSource = "api") => {
  await page.addInitScript((source) => {
    localStorage.setItem("goldback-pricing-source", JSON.stringify(source));
  }, gbSource);
};

const populateRatioInputs = async (page) => {
  await page.waitForFunction(() => typeof window.renderRatioChips === "function");
  await page.evaluate(() => {
    if (typeof spotPrices !== "undefined") {
      spotPrices.gold = 4328.97;
      spotPrices.silver = 67.84;
      spotPrices.platinum = 1778.07;
      spotPrices.palladium = 1225.67;
    }
    if (typeof goldbackPrices !== "undefined") {
      goldbackPrices["1"] = {
        price: 8.68,
        updatedAt: Date.now(),
        source: "api",
        ts: Math.floor(Date.now() / 1000),
        staleAfter: 90000,
      };
    }
    window.renderRatioChips();
  });
};

test.describe("core/settings-api", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("API settings render Market, Spot, and Catalog sections without the legacy tab bar", async ({
    page,
  }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const panel = page.locator("#settingsPanel_api");
    await expect(panel.locator(".settings-provider-tabs")).toHaveCount(0);
    await expect(panel.locator(".settings-provider-tab")).toHaveCount(0);

    const sections = panel.locator(".settings-fieldset .settings-fieldset-title");
    await expect(sections.nth(0)).toContainText(/Market/i);
    await expect(sections.nth(1)).toContainText(/Spot/i);
    await expect(sections.nth(2)).toContainText(/Catalog/i);
  });

  test("Gold API is a first-class spot provider and activates its panel", async ({ page }) => {
    await seedApiState(page, { spotPricingSource: "STAKTRAKR" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const spotSection = page.locator("#apiSection_spot");
    const goldApiPill = spotSection.locator('.gb-source-btn[data-val="GOLD_API"]');
    const pills = spotSection.locator(".gb-source-btn");
    await expect(pills).toHaveCount(7);
    await expect(goldApiPill).toHaveCount(1);
    await goldApiPill.click();
    await confirmProviderSwitch(page, "Gold API");

    await expect(goldApiPill).toHaveClass(/active/);
    await expect(goldApiPill).toHaveAttribute("aria-checked", "true");
    expect(await readSpotPricingSource(page)).toBe("GOLD_API");
  });

  // STRK-342 — the pre-fix listener targeted `.provider-metal[data-provider]`
  // markup that no longer exists, so "Metals to track" checkboxes neither
  // hydrated from nor persisted to metalApiConfig.metals.
  test("Metals to track hydrates checkbox state from metalApiConfig", async ({ page }) => {
    await seedApiState(page, {
      spotPricingSource: "METALS_API",
      metalApiConfig: { metals: { METALS_API: { platinum: false } } },
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const panel = page.locator('#apiSection_spot .spot-accordion-panel[data-val="METALS_API"]');
    await expect(panel.locator('.metal-checkboxes input[data-metal="platinum"]')).not.toBeChecked();
    await expect(panel.locator('.metal-checkboxes input[data-metal="gold"]')).toBeChecked();
  });

  test("Metals to track persists per-provider selection changes", async ({ page }) => {
    await seedApiState(page, { spotPricingSource: "METALS_API" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const panel = page.locator('#apiSection_spot .spot-accordion-panel[data-val="METALS_API"]');
    const goldCheckbox = panel.locator('.metal-checkboxes input[data-metal="gold"]');
    await expect(goldCheckbox).toBeChecked();
    await goldCheckbox.uncheck();

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = localStorage.getItem("metalApiConfig");
          return raw ? JSON.parse(raw).metals?.METALS_API?.gold : undefined;
        })
      )
      .toBe(false);

    // Other providers' selections are untouched by a per-provider change.
    const goldApiGold = await page.evaluate(() => {
      const raw = localStorage.getItem("metalApiConfig");
      return raw ? JSON.parse(raw).metals?.GOLD_API?.gold : undefined;
    });
    expect(goldApiGold).not.toBe(false);
  });

  test("Catalog API key state remains sync-scoped and round-trips through storage helpers", async ({
    page,
  }) => {
    const catalogConfig = { numista: { apiKey: btoa("test-numista-key-12345") } };
    await page.addInitScript((config) => {
      localStorage.setItem("catalog_api_config", JSON.stringify(config));
    }, catalogConfig);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const isAllowed = await page.evaluate(() => {
      if (window.ALLOWED_STORAGE_KEYS instanceof Set) {
        return window.ALLOWED_STORAGE_KEYS.has("catalog_api_config");
      }
      return Array.isArray(window.ALLOWED_STORAGE_KEYS)
        ? window.ALLOWED_STORAGE_KEYS.includes("catalog_api_config")
        : false;
    });
    expect(isAllowed).toBe(true);

    const roundTrip = await page.evaluate(() => {
      const original = localStorage.getItem("catalog_api_config");
      if (typeof window.saveDataSync === "function" && typeof window.loadDataSync === "function") {
        window.saveDataSync("catalog_api_config", JSON.parse(original));
        return JSON.stringify(window.loadDataSync("catalog_api_config")) === original;
      }
      return false;
    });
    expect(roundTrip).toBe(true);
  });

  test("Currency settings keep Goldback pricing controls and history access in the currency panel", async ({
    page,
  }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openSettingsSection(page, "currency");

    await expect(page.locator('.settings-nav-item[data-section="goldback"]')).toHaveCount(0);
    await expect(page.locator("#settingsPanel_goldback")).toHaveCount(0);

    const sourceGroup = page.locator("#settingsPanel_currency #settingsGoldbackSource");
    await expect(sourceGroup.locator(".gb-source-btn")).toHaveCount(4);
    await expect(sourceGroup.locator('.gb-source-btn[data-val="api"]')).toContainText(
      "StakTrakr API"
    );

    const manualButton = sourceGroup.locator('.gb-source-btn[data-val="manual"]');
    await manualButton.click();
    await expect(manualButton).toHaveClass(/active/);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("goldback-pricing-source")))
    ).toBe("manual");

    await expect(page.locator("#settingsPanel_currency #goldbackSpotModifierGroup")).toBeHidden();
    await expect(page.locator("#settingsPanel_currency #goldbackManualInputGroup")).toBeVisible();
    const denominationTable = page.locator("#settingsPanel_currency #goldbackPriceTable");
    await expect(denominationTable.locator("tbody tr")).not.toHaveCount(0);
    await expect(denominationTable.locator('input, button[type="submit"]')).toHaveCount(0);

    await page.locator("#settingsPanel_currency #goldbackHistoryBtn").click();
    await expect(page.locator("#goldbackHistoryModal")).toBeVisible();
  });

  test('STRK-161: "Show spot ratios" toggle is in the Currency panel, defaults ON, and persists to localStorage (AC-10)', async ({
    page,
  }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openSettingsSection(page, "currency");

    const toggle = page.locator("#settingsPanel_currency #showSpotRatiosToggle");
    await expect(toggle).toHaveCount(1);
    // Default ON: the "yes" pill is active with no prior localStorage entry.
    await expect(toggle.locator('.chip-sort-btn[data-val="yes"]')).toHaveClass(/active/);
    await expect(toggle.locator('.chip-sort-btn[data-val="no"]')).not.toHaveClass(/active/);

    // Toggling OFF persists 'false' under the new key (AC-10).
    await toggle.locator('.chip-sort-btn[data-val="no"]').click();
    await expect(toggle.locator('.chip-sort-btn[data-val="no"]')).toHaveClass(/active/);
    expect(await page.evaluate(() => localStorage.getItem("show-spot-ratios"))).toBe("false");

    // Regression (PR #1232): the key must be in ALLOWED_STORAGE_KEYS so it survives
    // cleanupStorage() — that runs on every DOMContentLoaded and deletes any key not
    // whitelisted. Without the entry the OFF state would silently reset on reload.
    expect(
      await page.evaluate(() => {
        cleanupStorage();
        return localStorage.getItem("show-spot-ratios");
      })
    ).toBe("false");

    // Toggling back ON persists 'true'.
    await toggle.locator('.chip-sort-btn[data-val="yes"]').click();
    await expect(toggle.locator('.chip-sort-btn[data-val="yes"]')).toHaveClass(/active/);
    expect(await page.evaluate(() => localStorage.getItem("show-spot-ratios"))).toBe("true");
  });

  test("STRK-161: toggling the spot-ratios setting shows/hides all four chips live without reload (AC-11)", async ({
    page,
  }) => {
    await seedRatioState(page, "api");
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await populateRatioInputs(page);

    // Default ON: all four chips are present.
    await expect(page.locator(SPOT_RATIO_CHIP)).toHaveCount(4);

    await openSettingsSection(page, "currency");
    const toggle = page.locator("#settingsPanel_currency #showSpotRatiosToggle");

    // OFF → all four chips removed live (no reload).
    await toggle.locator('.chip-sort-btn[data-val="no"]').click();
    await expect(page.locator(SPOT_RATIO_CHIP)).toHaveCount(0);

    // ON → all four chips return live.
    await toggle.locator('.chip-sort-btn[data-val="yes"]').click();
    await expect(page.locator(SPOT_RATIO_CHIP)).toHaveCount(4);
  });

  test("STRK-161: while the toggle is OFF, all chips stay hidden regardless of goldback mode or spot validity (AC-12)", async ({
    page,
  }) => {
    await seedRatioState(page, "api");
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await populateRatioInputs(page);

    // Baseline: master ON + valid spot + fresh goldback → all four chips render.
    // (Anchors the test to real render behavior so it is RED against the stub.)
    await expect(page.locator(SPOT_RATIO_CHIP)).toHaveCount(4);

    // Turn the master toggle OFF.
    await openSettingsSection(page, "currency");
    await page
      .locator('#settingsPanel_currency #showSpotRatiosToggle .chip-sort-btn[data-val="no"]')
      .click();
    await expect(page.locator(SPOT_RATIO_CHIP)).toHaveCount(0);

    // Master OFF wins over any goldback mode (spot is a valid, chip-eligible mode).
    await page.evaluate(() => {
      if (typeof saveGoldbackPricingSource === "function") saveGoldbackPricingSource("spot");
      window.renderRatioChips();
    });
    await expect(page.locator(SPOT_RATIO_CHIP)).toHaveCount(0);

    // Master OFF wins over goldback off as well.
    await page.evaluate(() => {
      if (typeof saveGoldbackPricingSource === "function") saveGoldbackPricingSource("off");
      window.renderRatioChips();
    });
    await expect(page.locator(SPOT_RATIO_CHIP)).toHaveCount(0);
  });

  test('STRK-161: switching goldback pricing mode to "off" hides the gold chip live while the other three remain (AC-7)', async ({
    page,
  }) => {
    await seedRatioState(page, "api");
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await populateRatioInputs(page);

    // Goldback mode non-off + valid G1 → gold chip present, plus three ratio chips.
    await expect(goldChip(page)).toHaveCount(1);
    await expect(nonGoldChips(page)).toHaveCount(3);

    await openSettingsSection(page, "currency");
    // Switch goldback pricing mode to "off" via the source pill.
    await page
      .locator('#settingsPanel_currency #settingsGoldbackSource .gb-source-btn[data-val="off"]')
      .click();

    // Gold chip hides live; the three ratio chips remain (AC-7).
    await expect(goldChip(page)).toHaveCount(0);
    await expect(nonGoldChips(page)).toHaveCount(3);
  });

  test("System settings keep destructive reset actions isolated from storage settings", async ({
    page,
  }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openSettingsSection(page, "system");

    const systemPanel = page.locator("#settingsPanel_system");
    await expect(systemPanel.locator("#removeInventoryDataBtn")).toBeVisible();
    await expect(systemPanel.locator("#boatingAccidentBtn")).toBeVisible();

    await openSettingsSection(page, "storage");
    const storagePanel = page.locator("#settingsPanel_storage");
    await expect(storagePanel.locator("#removeInventoryDataBtn")).toHaveCount(0);
    await expect(storagePanel.locator("#boatingAccidentBtn")).toHaveCount(0);
  });

  test("System export actions keep print, PDF, and ZIP restore wiring in the right cards", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window._openCallArgs = [];
      window.open = (...args) => {
        window._openCallArgs.push(args);
        return { closed: false };
      };
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openSettingsSection(page, "system");

    const panel = page.locator("#settingsPanel_system");
    await expect(panel.locator(".export-block #printBtn")).toBeVisible();
    await expect(panel.locator(".export-block #printBtn")).toHaveAttribute(
      "aria-describedby",
      "printDesc"
    );
    await expect(panel.locator(".import-block #importZipBtn")).toHaveCount(1);
    await expect(panel.locator(".export-block #importZipBtn")).toHaveCount(0);

    for (const id of ["removeInventoryDataBtn", "boatingAccidentBtn"]) {
      const style = await panel.locator(`#${id}`).getAttribute("style");
      expect(style).toContain("font-size: 0.82rem");
    }

    await page.waitForFunction(() => window.jspdf && window.jspdf.jsPDF);
    await page.evaluate(() => {
      window._pdfSaveCalls = [];
      const OriginalJsPDF = window.jspdf.jsPDF;
      function SpyJsPDF(...args) {
        const instance = new OriginalJsPDF(...args);
        instance.save = (filename) => {
          window._pdfSaveCalls.push(filename);
        };
        return instance;
      }
      SpyJsPDF.prototype = OriginalJsPDF.prototype;
      window.jspdf.jsPDF = SpyJsPDF;
    });

    await panel.locator("#printBtn").click();
    const printCalls = await page.evaluate(() => window._openCallArgs);
    expect(printCalls).toHaveLength(1);
    expect(printCalls[0][0]).toMatch(/^blob:/);
    expect(printCalls[0][1]).toBe("_blank");

    await panel.locator("#exportPdfBtn").click();
    const pdfCalls = await page.evaluate(() => window._pdfSaveCalls);
    expect(pdfCalls).toHaveLength(1);
    expect(pdfCalls[0]).toMatch(/^metal_inventory_\d{8}\.pdf$/);
  });
});

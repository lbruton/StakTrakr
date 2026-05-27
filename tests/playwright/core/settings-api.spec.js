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

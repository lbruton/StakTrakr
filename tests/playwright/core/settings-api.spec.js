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
});

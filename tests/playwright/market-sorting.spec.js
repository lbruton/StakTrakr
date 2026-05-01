import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "./helpers/seed.js";

/**
 * STRK-21 — Market Price Matrix Sorting
 *
 * TDD tests (red phase): vendor columns and item rows must appear in alphabetical
 * order by display name. These tests FAIL before the fix in js/market-data.js and
 * PASS after it.
 *
 * REQ-1: Vendor columns sorted alphabetically by _shortVendor() display name
 * REQ-2: Item rows sorted alphabetically by meta.name
 */

// Three vendor IDs injected in REVERSE-alphabetical display order:
//   herobullion → "Hero", apmex → "APMEX", bullionexchanges → "BullionX"
// After fix, column order must be: APMEX, BullionX, Hero
const VENDORS = [
  { id: "herobullion", name: "Hero Bullion", color: "#10b981", url: "https://herobullion.com" },
  { id: "apmex", name: "APMEX", color: "#60a5fa", url: "https://www.apmex.com" },
  {
    id: "bullionexchanges",
    name: "Bullion Exchanges",
    color: "#f59e0b",
    url: "https://www.bullionexchanges.com",
  },
];

// Three slugs with names in REVERSE-alphabetical order so insertion order ≠ sorted order.
// Each slug is assigned a unique vendor so Set insertion order tracks slug order exactly.
const SLUG_Z = "strk21-zebra"; // Zebra Silver Round — last alphabetically
const SLUG_A = "strk21-alpha"; // Alpha Silver Bar   — first alphabetically
const SLUG_M = "strk21-middle"; // Middle Silver Coin — second alphabetically

const generatedAt = new Date().toISOString();

const coinMeta = {
  [SLUG_Z]: { name: "Zebra Silver Round", weight: 1, metal: "silver" },
  [SLUG_A]: { name: "Alpha Silver Bar", weight: 1, metal: "silver" },
  [SLUG_M]: { name: "Middle Silver Coin", weight: 1, metal: "silver" },
};

const vendorMeta = Object.fromEntries(
  VENDORS.map((v) => [v.id, { name: v.name, color: v.color, url: v.url }])
);

// Prices keyed so Zebra is first, Alpha second, Middle third — non-alphabetical.
// Each slug gets a single unique vendor to make Set insertion order predictable.
const prices = {
  lastSync: generatedAt,
  window_start: generatedAt,
  prices: {
    [SLUG_Z]: {
      median_price: 42.0,
      lowest_price: 41.5,
      highest_price: 43.0,
      vendors: {
        herobullion: { price: 42.0, inStock: true, in_stock: true },
      },
    },
    [SLUG_A]: {
      median_price: 38.0,
      lowest_price: 37.5,
      highest_price: 39.0,
      vendors: {
        apmex: { price: 38.0, inStock: true, in_stock: true },
      },
    },
    [SLUG_M]: {
      median_price: 40.0,
      lowest_price: 39.5,
      highest_price: 41.0,
      vendors: {
        bullionexchanges: { price: 40.0, inStock: true, in_stock: true },
      },
    },
  },
};

// Per-slug detail served by the mocked API route
const detailBySlug = {
  [SLUG_Z]: {
    weight_oz: 1,
    median: 42.0,
    median_price: 42.0,
    low: 41.5,
    lowest_price: 41.5,
    high: 43.0,
    highest_price: 43.0,
    window_start: generatedAt,
    vendors: {
      herobullion: { price: 42.0, in_stock: true, inStock: true, url: "https://herobullion.com" },
    },
  },
  [SLUG_A]: {
    weight_oz: 1,
    median: 38.0,
    median_price: 38.0,
    low: 37.5,
    lowest_price: 37.5,
    high: 39.0,
    highest_price: 39.0,
    window_start: generatedAt,
    vendors: {
      apmex: { price: 38.0, in_stock: true, inStock: true, url: "https://www.apmex.com" },
    },
  },
  [SLUG_M]: {
    weight_oz: 1,
    median: 40.0,
    median_price: 40.0,
    low: 39.5,
    lowest_price: 39.5,
    high: 41.0,
    highest_price: 41.0,
    window_start: generatedAt,
    vendors: {
      bullionexchanges: {
        price: 40.0,
        in_stock: true,
        inStock: true,
        url: "https://www.bullionexchanges.com",
      },
    },
  },
};

const setupSortingFixture = async (page) => {
  await injectSeedInventory(page);

  await page.addInitScript(
    ({ pricesData, slugs, meta, vendors, generatedAtValue }) => {
      const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
      writeJson("v2RetailPrices", pricesData);
      writeJson("retailPrices", pricesData);
      writeJson("retailManifestSlugs", slugs);
      writeJson("retailManifestCoinMeta", meta);
      writeJson("retailManifestVendorMeta", vendors);
      localStorage.setItem("retailManifestGeneratedAt", generatedAtValue);
      localStorage.setItem("spotSilver", JSON.stringify(36));
      // Stub LightweightCharts so market detail modal works without the CDN
      window.LightweightCharts = {
        CrosshairMode: { Normal: 0 },
        createChart(container) {
          const root = document.createElement("div");
          root.className = "tv-lightweight-charts";
          container.appendChild(root);
          return {
            addLineSeries() {
              return { setData() {} };
            },
            timeScale() {
              return { fitContent() {} };
            },
            remove() {
              root.remove();
            },
          };
        },
      };
    },
    {
      pricesData: prices,
      slugs: [SLUG_Z, SLUG_A, SLUG_M],
      meta: coinMeta,
      vendors: vendorMeta,
      generatedAtValue: generatedAt,
    }
  );

  // Serve per-slug detail from the mocked API so _renderVendorTable can fetch it
  await page.route("https://api.staktrakr.com/data/v2/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/data\/v2\//, "");
    const match = path.match(/^retail\/([^/]+)\/latest\.json$/);
    if (match && detailBySlug[match[1]]) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ v: 2, generated_at: generatedAt, data: detailBySlug[match[1]] }),
      });
    } else {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
  });

  await page.route("https://api2.staktrakr.com/data/v2/**", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  await page.goto("/index.html");
  await page.waitForFunction(
    () =>
      typeof window.showSettingsModal === "function" &&
      typeof window.renderVendorPrices === "function" &&
      typeof window.refreshMarketData === "function"
  );
  await page.evaluate(() => window.refreshMarketData());
  // Wait for the vendor table to render
  await page.waitForSelector(".vendor-prices-table", { timeout: 10000 });
};

test.describe("STRK-21 — Market price matrix sorting", () => {
  test.beforeEach(async ({ page }) => {
    await setupSortingFixture(page);
  });

  // REQ-1: Vendor column headers are sorted alphabetically by display name.
  // Input order in localStorage: Hero, APMEX, BullionX (non-alphabetical).
  // Expected rendered order: APMEX, BullionX, Hero.
  test("REQ-1 — vendor columns appear in alphabetical order by display name", async ({ page }) => {
    const table = page.locator(".vendor-prices-table");
    await expect(table).toBeVisible();

    // Collect all header text, strip the fixed "ITEM", "MEDIAN", "SPREAD" columns
    const headers = await table.locator("thead tr th").allTextContents();
    const vendorHeaders = headers.filter((h) => !["ITEM", "MEDIAN", "SPREAD"].includes(h.trim()));

    // Exact expected order: the 3 fixture vendors sorted alphabetically by _shortVendor() label
    expect(vendorHeaders).toEqual(["APMEX", "BullionX", "Hero"]);
  });

  // REQ-2: Item rows are sorted alphabetically by display name (meta.name).
  // Input order in localStorage: Zebra Silver Round, Alpha Silver Bar, Middle Silver Coin.
  // Expected rendered order: Alpha Silver Bar, Middle Silver Coin, Zebra Silver Round.
  test("REQ-2 — item rows appear in alphabetical order by display name", async ({ page }) => {
    const table = page.locator(".vendor-prices-table");
    await expect(table).toBeVisible();

    // Collect item names from the first cell of each body row (the .vp-coin-link span)
    const rowNames = await table.locator("tbody tr td:first-child").allTextContents();
    const trimmed = rowNames.map((n) => n.trim()).filter(Boolean);

    // Exact expected order: the 3 fixture slugs sorted alphabetically by meta.name
    expect(trimmed).toEqual(["Alpha Silver Bar", "Middle Silver Coin", "Zebra Silver Round"]);
  });
});

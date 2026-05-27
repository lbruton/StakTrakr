import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

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

const MARKET_FILTER_KEY = "staktrakr.market_filter";
const GOLDBACK_G1_RATE = 4.25;

// Five vendor IDs injected in REVERSE-ish alphabetical display order:
//   herobullion -> "Hero", jmbullion -> "JM", goldback -> "Goldback",
//   apmex -> "APMEX", bullionexchanges -> "BullionX"
// After sorting, column order must be: APMEX, BullionX, Goldback, Hero, JM
const VENDORS = [
  { id: "herobullion", name: "Hero Bullion", color: "#10b981", url: "https://herobullion.com" },
  { id: "jmbullion", name: "JM Bullion", color: "#ef4444", url: "https://www.jmbullion.com" },
  { id: "goldback", name: "Goldback", color: "#fbbf24", url: "https://www.goldback.com" },
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
const SLUG_GOLD_A = "strk75-alpha-gold"; // Alpha Gold Coin — first gold row
const SLUG_GOLD_Z = "strk75-zulu-gold"; // Zulu Gold Coin  — second gold row
const SLUG_GOLDBACK = "strk75-utah-goldback-g1"; // Goldback rows sort after metals

const generatedAt = new Date().toISOString();

const coinMeta = {
  [SLUG_Z]: { name: "Zebra Silver Round", weight: 1, metal: "silver" },
  [SLUG_A]: { name: "Alpha Silver Bar", weight: 1, metal: "silver" },
  [SLUG_M]: { name: "Middle Silver Coin", weight: 1, metal: "silver" },
  [SLUG_GOLD_A]: { name: "Alpha Gold Coin", weight: 1, metal: "gold" },
  [SLUG_GOLD_Z]: { name: "Zulu Gold Coin", weight: 1, metal: "gold" },
  [SLUG_GOLDBACK]: { name: "Utah 1 Goldback", weight: 0, metal: "goldback" },
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
    [SLUG_GOLD_Z]: {
      median_price: 2150.0,
      lowest_price: 2150.0,
      highest_price: 2150.0,
      vendors: {
        jmbullion: { price: 2150.0, inStock: true, in_stock: true },
      },
    },
    [SLUG_GOLD_A]: {
      median_price: 2200.0,
      lowest_price: 2200.0,
      highest_price: 2200.0,
      vendors: {
        apmex: { price: 2200.0, inStock: true, in_stock: true },
      },
    },
    [SLUG_GOLDBACK]: {
      median_price: 5.1,
      lowest_price: 5.1,
      highest_price: 5.1,
      vendors: {
        goldback: { price: 5.1, inStock: true, in_stock: true },
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
  [SLUG_GOLD_Z]: {
    weight_oz: 1,
    median: 2150.0,
    median_price: 2150.0,
    low: 2150.0,
    lowest_price: 2150.0,
    high: 2150.0,
    highest_price: 2150.0,
    window_start: generatedAt,
    vendors: {
      jmbullion: {
        price: 2150.0,
        in_stock: true,
        inStock: true,
        url: "https://www.jmbullion.com",
      },
    },
  },
  [SLUG_GOLD_A]: {
    weight_oz: 1,
    median: 2200.0,
    median_price: 2200.0,
    low: 2200.0,
    lowest_price: 2200.0,
    high: 2200.0,
    highest_price: 2200.0,
    window_start: generatedAt,
    vendors: {
      apmex: { price: 2200.0, in_stock: true, inStock: true, url: "https://www.apmex.com" },
    },
  },
  [SLUG_GOLDBACK]: {
    weight_oz: 0,
    median: 5.1,
    median_price: 5.1,
    low: 5.1,
    lowest_price: 5.1,
    high: 5.1,
    highest_price: 5.1,
    window_start: generatedAt,
    vendors: {
      goldback: { price: 5.1, in_stock: true, inStock: true, url: "https://www.goldback.com" },
    },
  },
};

const setupSortingFixture = async (page, options = {}) => {
  await injectSeedInventory(page);

  await page.addInitScript(
    ({ pricesData, slugs, meta, vendors, generatedAtValue, savedTab, marketFilter, filterKey }) => {
      const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
      writeJson("v2RetailPrices", pricesData);
      writeJson("retailPrices", pricesData);
      writeJson("retailManifestSlugs", slugs);
      writeJson("retailManifestCoinMeta", meta);
      writeJson("retailManifestVendorMeta", vendors);
      localStorage.setItem("retailManifestGeneratedAt", generatedAtValue);
      localStorage.setItem("spotSilver", JSON.stringify(36));
      localStorage.setItem("spotGold", JSON.stringify(2000));
      if (savedTab !== undefined) writeJson("vendorPricesActiveTab", savedTab);
      if (marketFilter) writeJson(filterKey, marketFilter);
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
      slugs: [SLUG_Z, SLUG_A, SLUG_M, SLUG_GOLD_Z, SLUG_GOLD_A, SLUG_GOLDBACK],
      meta: coinMeta,
      vendors: vendorMeta,
      generatedAtValue: generatedAt,
      savedTab: options.savedTab,
      marketFilter: options.marketFilter,
      filterKey: MARKET_FILTER_KEY,
    }
  );

  // Serve per-slug detail from the mocked API so _renderVendorTable can fetch it
  await page.route("https://api.staktrakr.com/data/v2/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/data\/v2\//, "");
    if (path === "goldback/latest.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 2,
          generated_at: generatedAt,
          data: { g1_usd: GOLDBACK_G1_RATE },
        }),
      });
      return;
    }
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
      typeof window.initMarketData === "function" &&
      typeof window.refreshMarketData === "function"
  );
  await page.evaluate(() => {
    if (typeof spotPrices !== "undefined") {
      spotPrices.gold = 2000;
      spotPrices.silver = 36;
    }
  });
  await page.evaluate(() => window.initMarketData());
  await page.evaluate(() => window.refreshMarketData());
  // Wait for the vendor table to render
  await page.waitForSelector(".vendor-prices-table", { timeout: 10000 });
};

const getActiveMarketTab = async (page) =>
  page.locator(".vendor-prices-tabs button.active").getAttribute("data-metal");

const getMarketTabLabels = async (page) =>
  (await page.locator(".vendor-prices-tabs button").allTextContents()).map((label) => label.trim());

const getVendorHeaders = async (page) => {
  const headers = await page.locator(".vendor-prices-table thead tr th").allTextContents();
  return headers.map((h) => h.trim()).filter((h) => !["ITEM", "MEDIAN", "SPREAD"].includes(h));
};

const getRowNames = async (page) =>
  (await page.locator(".vendor-prices-table tbody tr td:first-child").allTextContents())
    .map((name) => name.trim())
    .filter(Boolean);

const getVendorCellText = async (page, rowName, vendorHeader) =>
  page.locator(".vendor-prices-table").evaluate(
    (table, args) => {
      const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
        th.textContent.trim()
      );
      const columnIndex = headers.indexOf(args.vendorHeader);
      if (columnIndex === -1) return null;
      const row = Array.from(table.querySelectorAll("tbody tr")).find((tr) => {
        const firstCell = tr.querySelector("td:first-child");
        return firstCell && firstCell.textContent.trim() === args.rowName;
      });
      if (!row) return null;
      return row.children[columnIndex] ? row.children[columnIndex].textContent.trim() : null;
    },
    { rowName, vendorHeader }
  );

test.describe("STRK-21 — Market price matrix sorting", () => {
  // REQ-1: Vendor column headers are sorted alphabetically by display name.
  // Input order in localStorage: Hero, APMEX, BullionX (non-alphabetical).
  // Expected rendered order: APMEX, BullionX, Hero.
  test("REQ-1 — vendor columns appear in alphabetical order by display name", async ({ page }) => {
    await setupSortingFixture(page, { savedTab: "xag" });

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
    await setupSortingFixture(page, { savedTab: "xag" });

    const table = page.locator(".vendor-prices-table");
    await expect(table).toBeVisible();

    // Collect item names from the first cell of each body row (the .vp-coin-link span)
    const rowNames = await table.locator("tbody tr td:first-child").allTextContents();
    const trimmed = rowNames.map((n) => n.trim()).filter(Boolean);

    // Exact expected order: the 3 fixture slugs sorted alphabetically by meta.name
    expect(trimmed).toEqual(["Alpha Silver Bar", "Middle Silver Coin", "Zebra Silver Round"]);
  });
});

test.describe("STRK-75 — Market price matrix All tab", () => {
  test("AC-1/AC-2 — All tab is present, first, and active by default with no stored value", async ({
    page,
  }) => {
    await setupSortingFixture(page);

    expect(await getMarketTabLabels(page)).toEqual(["All", "Gold", "Silver", "Goldback"]);
    expect(await getActiveMarketTab(page)).toBe("all");
    expect(await getRowNames(page)).toEqual([
      "Alpha Gold Coin",
      "Zulu Gold Coin",
      "Alpha Silver Bar",
      "Middle Silver Coin",
      "Zebra Silver Round",
      "Utah 1 Goldback",
    ]);
  });

  test("AC-3 — valid stored xag tab is preserved as Silver", async ({ page }) => {
    await setupSortingFixture(page, { savedTab: "xag" });

    expect(await getActiveMarketTab(page)).toBe("xag");
    await expect(page.locator(".vendor-prices-tabs button.active")).toHaveText("Silver");
    expect(await getRowNames(page)).toEqual([
      "Alpha Silver Bar",
      "Middle Silver Coin",
      "Zebra Silver Round",
    ]);
  });

  test("AC-4 — invalid stored tab falls back to All", async ({ page }) => {
    await setupSortingFixture(page, { savedTab: "stale-metal" });

    expect(await getActiveMarketTab(page)).toBe("all");
    await expect(page.locator(".vendor-prices-tabs button.active")).toHaveText("All");
    await expect(page.locator(".vendor-prices-table")).toContainText("Alpha Gold Coin");
    await expect(page.locator(".vendor-prices-table")).toContainText("Utah 1 Goldback");
  });

  test("AC-5 — All-tab rows are grouped Gold, Silver, then Goldback", async ({ page }) => {
    await setupSortingFixture(page);

    expect(await getRowNames(page)).toEqual([
      "Alpha Gold Coin",
      "Zulu Gold Coin",
      "Alpha Silver Bar",
      "Middle Silver Coin",
      "Zebra Silver Round",
      "Utah 1 Goldback",
    ]);
  });

  test("AC-6 — clicking a per-metal tab narrows the table correctly", async ({ page }) => {
    await setupSortingFixture(page);

    await page.locator('.vendor-prices-tabs button[data-metal="xau"]').click();

    expect(await getActiveMarketTab(page)).toBe("xau");
    expect(await getRowNames(page)).toEqual(["Alpha Gold Coin", "Zulu Gold Coin"]);
    await expect(page.locator(".vendor-prices-table")).not.toContainText("Alpha Silver Bar");
    await expect(page.locator(".vendor-prices-table")).not.toContainText("Utah 1 Goldback");
  });

  test("AC-7 — market-filter hiding applies in the All tab", async ({ page }) => {
    await setupSortingFixture(page, {
      marketFilter: {
        [SLUG_GOLD_Z]: { jmbullion: false },
      },
    });

    expect(await getActiveMarketTab(page)).toBe("all");
    expect(await getRowNames(page)).toEqual([
      "Alpha Gold Coin",
      "Alpha Silver Bar",
      "Middle Silver Coin",
      "Zebra Silver Round",
      "Utah 1 Goldback",
    ]);
    await expect(page.locator(".vendor-prices-table")).not.toContainText("Zulu Gold Coin");
  });

  test("AC-8 — All-tab premium math uses per-row spot and Goldback G1 rate", async ({ page }) => {
    await setupSortingFixture(page);

    const goldCell = await getVendorCellText(page, "Alpha Gold Coin", "APMEX");
    expect(goldCell).toContain("$2,200.00");
    expect(goldCell).toContain("+10.0%");

    const silverCell = await getVendorCellText(page, "Alpha Silver Bar", "APMEX");
    expect(silverCell).toContain("$38.00");
    expect(silverCell).toContain("+5.6%");

    const goldbackCell = await getVendorCellText(page, "Utah 1 Goldback", "Goldback");
    expect(goldbackCell).toContain("$5.10");
    expect(goldbackCell).toContain("+20.0%");
  });

  test("AC-9 — All-tab vendor columns are the sorted union across metals", async ({ page }) => {
    await setupSortingFixture(page);

    expect(await getVendorHeaders(page)).toEqual(["APMEX", "BullionX", "Goldback", "Hero", "JM"]);
    expect(await getVendorCellText(page, "Alpha Gold Coin", "Goldback")).toBe("—");
    expect(await getVendorCellText(page, "Utah 1 Goldback", "JM")).toBe("—");
    expect(await getVendorCellText(page, "Zulu Gold Coin", "JM")).toContain("$2,150.00");
  });
});

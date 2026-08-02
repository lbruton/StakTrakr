import { test, expect } from "../helpers/mocks/extended-test.js";

const FIXED_NOW_ISO = "2026-05-10T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

test.use({ locale: "en-US", timezoneId: "America/Chicago" });

const BASE_ITEM = {
  uuid: "core-valuation-base",
  metal: "Silver",
  composition: "Silver",
  name: "Core Valuation ASE",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 38,
  marketValue: 75,
  date: "2025-01-10",
  purchaseLocation: "Playwright",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2025",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 38,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
};

const SINGLE_GOLD = {
  ...BASE_ITEM,
  uuid: "core-valuation-single-gold",
  metal: "Gold",
  composition: "Gold",
  name: "Core Single Gold Eagle",
  price: 2100,
  pricingType: "each",
  spotPriceAtPurchase: 2000,
  marketValue: 2200,
  date: "2030-01-15",
  purity: 1,
};

const LOT_SILVER = {
  ...BASE_ITEM,
  uuid: "core-valuation-silver-lot",
  name: "Core Silver Lot",
  qty: 5,
  price: 150,
  pricingType: "lot",
  spotPriceAtPurchase: 0,
  marketValue: 0,
  date: "2030-01-15",
};

const NEG_PREMIUM = {
  ...SINGLE_GOLD,
  uuid: "core-valuation-negative-premium",
  name: "Core Negative Premium",
  price: 2800,
  spotPriceAtPurchase: 3000,
  marketValue: 2900,
};

const NO_SPOT = {
  ...SINGLE_GOLD,
  uuid: "core-valuation-no-spot",
  name: "Core No Spot",
  weight: 0,
  price: 1800,
  spotPriceAtPurchase: 0,
  marketValue: 0,
  date: "2031-06-15",
};

function daysAgo(days, spot = 70, metal = "Silver") {
  return {
    timestamp: new Date(new Date(FIXED_NOW_ISO).getTime() - days * DAY_MS).toISOString(),
    metal,
    spot,
    source: "seed",
    provider: "Playwright",
  };
}

function makeSpotHistory(days, spot = 70, metal = "Silver") {
  return Array.from({ length: days }, (_, index) => daysAgo(days - index - 1, spot, metal));
}

async function seedValuationData(page, options = {}) {
  const {
    inventory = [BASE_ITEM],
    spotHistory = makeSpotHistory(40),
    retailHistory = {
      [inventory[0]?.uuid || BASE_ITEM.uuid]: [
        { ts: new Date("2025-07-15T12:00:00.000Z").getTime(), retail: 68 },
      ],
    },
    goldbackPrices = {},
    goldbackPriceHistory = {},
    goldbackPricingSource = "api",
  } = options;

  await page.route("https://open.er-api.com/v6/latest/USD", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "success", base_code: "USD", rates: { EUR: 0.9 } }),
    });
  });

  await page.route("https://api.staktrakr.com/data/v2/spot/**", async (route) => {
    await route.abort();
  });

  await page.addInitScript(
    ({ seededInventory, history, itemHistory, gbPrices, gbHistory, gbSource, fixedNowIso }) => {
      const RealDate = Date;
      const fixedNow = new RealDate(fixedNowIso).getTime();
      class MockDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [fixedNow]));
        }
        static now() {
          return fixedNow;
        }
      }
      MockDate.UTC = RealDate.UTC;
      MockDate.parse = RealDate.parse;
      window.Date = MockDate;

      localStorage.setItem("metalInventory", JSON.stringify(seededInventory));
      localStorage.setItem("itemTags", JSON.stringify({}));
      localStorage.setItem("cardViewStyle", "D");
      localStorage.setItem("displayCurrency", JSON.stringify("USD"));
      localStorage.setItem("exchangeRates", JSON.stringify({ EUR: 0.9 }));
      localStorage.setItem("metalSpotHistory", JSON.stringify(history));
      localStorage.setItem("item-price-history", JSON.stringify(itemHistory));
      localStorage.setItem("goldback-prices", JSON.stringify(gbPrices));
      localStorage.setItem("goldback-price-history", JSON.stringify(gbHistory));
      localStorage.setItem("goldback-pricing-source", JSON.stringify(gbSource));
      localStorage.setItem("defaultSortColumn", "4");
      localStorage.setItem("defaultSortDir", "asc");
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
        },
        { once: true }
      );
    },
    {
      seededInventory: inventory,
      history: spotHistory,
      itemHistory: retailHistory,
      gbPrices: goldbackPrices,
      gbHistory: goldbackPriceHistory,
      gbSource: goldbackPricingSource,
      fixedNowIso: FIXED_NOW_ISO,
    }
  );
}

async function gotoApp(page) {
  // Deep-link into the Inventory tab (STRK-282): #newItemBtn lives in that
  // panel, and the v2 shell boots on Dashboard, so a bare /index.html leaves
  // this control display:none.
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.lookupHistoricalSpot === "function" &&
      typeof window.computeItemValuation === "function" &&
      typeof window.showViewModal === "function" &&
      typeof window.Chart !== "undefined" &&
      Array.isArray(window.inventory)
  );
}

async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

async function waitForChart(page) {
  await page.waitForFunction(() => {
    const canvas = document.getElementById("viewPriceHistoryChart");
    const chart = canvas && window.Chart?.getChart(canvas);
    return Boolean(chart?.scales?.y && chart.data?.datasets?.length);
  });
}

async function clickRange(page, label) {
  await page.locator(".view-chart-range-pill", { hasText: label }).click();
  await waitForChart(page);
}

async function chartSnapshot(page) {
  return page.evaluate(() => {
    const chart = Chart.getChart(document.getElementById("viewPriceHistoryChart"));
    return {
      yMin: chart.scales.y.min,
      yMax: chart.scales.y.max,
      suggestedMin: chart.options.scales.y.suggestedMin,
      suggestedMax: chart.options.scales.y.suggestedMax,
      labels: chart.data.labels,
      datasets: chart.data.datasets.map((dataset, index) => ({
        label: dataset.label,
        hidden: dataset.hidden === true,
        visible: chart.isDatasetVisible(index),
        fill: dataset.fill,
        order: dataset.order,
        data: dataset.data.filter((value) => value !== null && Number.isFinite(Number(value))),
      })),
    };
  });
}

function expectVisibleDatasetsWithinScale(snapshot) {
  for (const dataset of snapshot.datasets.filter((candidate) => candidate.visible)) {
    for (const value of dataset.data) {
      expect(value).toBeGreaterThanOrEqual(snapshot.yMin);
      expect(value).toBeLessThanOrEqual(snapshot.yMax);
    }
  }
}

function valuationCells(page) {
  return page.locator(
    "#viewItemModal .view-valuation-section .view-detail-grid.six-col .view-detail-item"
  );
}

test.describe("core/valuation", () => {
  test("historical spot lookup normalizes metals and falls back to nearby trading days", async ({
    page,
  }) => {
    await seedValuationData(page, { inventory: [SINGLE_GOLD] });
    await gotoApp(page);
    await page.evaluate(() => {
      window._loadSpotSeedBundle({
        2035: {
          Gold: [["01-16", 3200]],
          Silver: [["01-16", 34.5]],
        },
      });
    });

    expect(await page.evaluate(() => window.lookupHistoricalSpot("Gold", "2035-01-16"))).toBe(3200);
    expect(await page.evaluate(() => window.lookupHistoricalSpot("gold", "2035-01-13"))).toBe(3200);
    expect(
      await page.evaluate(() => window.lookupHistoricalSpot("Alloy", "2035-01-16"))
    ).toBeNull();
    expect(await page.evaluate(() => window.lookupHistoricalSpot("Gold", null))).toBeNull();
  });

  test("pricingType does not change per-unit purchase price math", async ({ page }) => {
    await seedValuationData(page, { inventory: [SINGLE_GOLD] });
    await gotoApp(page);

    const results = await page.evaluate(() => {
      return ["lot", "each", undefined].map((pricingType) => {
        const item = {
          qty: 3,
          price: 100,
          pricingType,
          weight: 1,
          weightUnit: "oz",
          purity: 0.999,
          marketValue: 0,
        };
        const { purchasePrice, purchaseTotal } = window.computeItemValuation(item, 0);
        return { purchasePrice, purchaseTotal };
      });
    });

    expect(results).toEqual([
      { purchasePrice: 100, purchaseTotal: 300 },
      { purchasePrice: 100, purchaseTotal: 300 },
      { purchasePrice: 100, purchaseTotal: 300 },
    ]);
  });

  test("valuation panel renders single, lot, gain/loss, and missing-spot states", async ({
    page,
  }) => {
    await seedValuationData(page, {
      inventory: [SINGLE_GOLD, LOT_SILVER, NEG_PREMIUM, NO_SPOT],
    });
    await gotoApp(page);

    await openViewModal(page, 0);
    await expect(valuationCells(page)).toHaveCount(6);
    await expect(valuationCells(page).nth(1).locator(".view-detail-value")).toHaveText(
      /^\+\d+\.\d+%$/
    );
    await expect(valuationCells(page).nth(5).locator(".view-detail-value")).toHaveClass(/gain/);
    await page.evaluate(() => window.closeViewModal?.());

    await openViewModal(page, 1);
    await expect(valuationCells(page)).toHaveCount(12);
    await page.evaluate(() => window.closeViewModal?.());

    await openViewModal(page, 2);
    await expect(valuationCells(page).nth(1).locator(".view-detail-value.loss")).toHaveText(
      /^-\d+\.\d+%$/
    );
    await page.evaluate(() => window.closeViewModal?.());

    await openViewModal(page, 3);
    await expect(valuationCells(page).nth(1).locator(".view-detail-value")).toHaveText("—");
    await expect(valuationCells(page).nth(1).locator(".view-detail-value")).toHaveClass(/muted/);
    await expect(valuationCells(page).nth(5).locator(".view-detail-value")).toHaveText("—");
    await expect(valuationCells(page).nth(5).locator(".view-detail-value")).toHaveClass(/muted/);
  });

  test("valuation grid keeps six desktop columns and three mobile columns", async ({ page }) => {
    const columnCount = async () =>
      page
        .locator("#viewItemModal .view-valuation-section .view-detail-grid.six-col")
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);

    await page.setViewportSize({ width: 1280, height: 800 });
    await seedValuationData(page, { inventory: [SINGLE_GOLD] });
    await gotoApp(page);
    await openViewModal(page, 0);
    expect(await columnCount()).toBe(6);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await gotoApp(page);
    await openViewModal(page, 0);
    expect(await columnCount()).toBe(3);
  });

  test("Goldback valuation chart uses denomination history and manual retail precedence", async ({
    page,
  }) => {
    const gbItem = {
      ...BASE_ITEM,
      uuid: "core-half-goldback",
      metal: "Gold",
      composition: "Gold",
      name: "Core Half Goldback",
      type: "Goldback",
      weight: 0.5,
      weightUnit: "gb",
      price: 0,
      marketValue: 100,
      date: "2026-05-04",
    };
    const goldHistory = Array.from({ length: 7 }, (_, index) => ({
      timestamp: new Date(
        new Date("2026-05-04T12:00:00.000Z").getTime() + index * DAY_MS
      ).toISOString(),
      metal: "Gold",
      spot: 4715.22,
      source: "seed",
      provider: "Playwright",
    }));

    await seedValuationData(page, {
      inventory: [gbItem],
      spotHistory: goldHistory,
      retailHistory: {
        [gbItem.uuid]: [{ ts: new Date("2026-05-10T13:00:00.000Z").getTime(), retail: 100 }],
      },
      goldbackPrices: {
        0.5: { price: 4.71, updatedAt: new Date(FIXED_NOW_ISO).getTime(), source: "api" },
      },
      goldbackPriceHistory: {
        0.5: [
          { ts: new Date("2026-05-08T12:00:00.000Z").getTime(), price: 4.74, source: "api" },
          { ts: new Date("2026-05-09T12:00:00.000Z").getTime(), price: 4.71, source: "api" },
          { ts: new Date("2026-05-10T12:00:00.000Z").getTime(), price: 4.71, source: "api" },
        ],
      },
      goldbackPricingSource: "manual",
    });
    await gotoApp(page);
    await openViewModal(page);
    await expect(page.locator(".view-valuation-section")).toContainText("$100.00");
    await clickRange(page, "7d");

    const retailValues = await page.evaluate(() => {
      const chart = Chart.getChart(document.getElementById("viewPriceHistoryChart"));
      const retailDataset = chart.data.datasets.find((dataset) => dataset.label === "Retail Value");
      return retailDataset.data.filter((value) => value !== null);
    });
    expect(retailValues).toContain(100);
    expect(retailValues).not.toContain(0);
  });

  test("chart ranges keep purchase, melt, and retail totals inside y-axis bounds", async ({
    page,
  }) => {
    await seedValuationData(page, {
      inventory: [{ ...BASE_ITEM, qty: 3, price: 10, marketValue: 20, purity: 1 }],
      spotHistory: makeSpotHistory(220, 15),
      retailHistory: {},
    });
    await gotoApp(page);
    await openViewModal(page);

    for (const range of ["7d", "1Y", "Purchased", "All"]) {
      await clickRange(page, range);
      const snapshot = await chartSnapshot(page);
      const purchaseDataset = snapshot.datasets.find(
        (dataset) => dataset.label === "Purchase Price"
      );
      const retailDataset = snapshot.datasets.find((dataset) => dataset.label === "Retail Value");
      expect(new Set(purchaseDataset.data)).toEqual(new Set([30]));
      expect(retailDataset.data.at(-1)).toBe(60);
      expectVisibleDatasetsWithinScale(snapshot);
    }
  });

  test("purchased range applies a 7-day floor caption for very recent purchases", async ({
    page,
  }) => {
    await seedValuationData(page, {
      inventory: [{ ...BASE_ITEM, date: "2026-05-07", price: 32, marketValue: 32 }],
      spotHistory: makeSpotHistory(8, 32),
    });
    await gotoApp(page);
    await openViewModal(page);

    await expect(page.locator("#viewChartCaption")).toBeVisible();
    await expect(page.locator("#viewChartCaption")).toHaveText(
      "Purchased 3 days ago — showing last 7 days"
    );
  });
});

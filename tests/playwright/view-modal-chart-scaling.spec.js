import { test, expect } from "@playwright/test";

const FIXED_NOW_ISO = "2026-05-10T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

const BASE_ITEM = {
  uuid: "strk42-chart-scaling-item",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-42 Chart Scaling ASE",
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

function daysAgo(days, spot = 70) {
  return {
    timestamp: new Date(new Date(FIXED_NOW_ISO).getTime() - days * DAY_MS).toISOString(),
    metal: "Silver",
    spot,
    source: "seed",
    provider: "Playwright",
  };
}

function makeSpotHistory(days, spot = 70) {
  return Array.from({ length: days }, (_, index) => daysAgo(days - index - 1, spot));
}

function yearEntry(date, spot = 70) {
  return {
    timestamp: `${date}T12:00:00.000Z`,
    metal: "Silver",
    spot,
    source: "year-file",
    provider: "Playwright",
  };
}

async function seedData(page, options = {}) {
  const {
    inventory = [BASE_ITEM],
    spotHistory = makeSpotHistory(40),
    retailHistory = {
      [inventory[0]?.uuid || BASE_ITEM.uuid]: [
        { ts: new Date("2025-07-15T12:00:00.000Z").getTime(), retail: 68 },
      ],
    },
  } = options;

  await page.route("https://open.er-api.com/v6/latest/USD", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: "success", base_code: "USD", rates: { EUR: 0.9 } }),
    });
  });

  await page.addInitScript(
    ({ seededInventory, history, itemHistory, fixedNowIso }) => {
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
      localStorage.setItem("itemPriceHistory", JSON.stringify(itemHistory));
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
      history: spotHistory,
      itemHistory: retailHistory,
      fixedNowIso: FIXED_NOW_ISO,
    }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.showViewModal === "function" &&
      Array.isArray(window.inventory) &&
      window.inventory.length > 0 &&
      typeof window.Chart !== "undefined"
  );
}

async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
  await expect(page.locator("#viewPriceHistoryChart")).toBeVisible();
  await waitForChart(page);
}

async function clickRange(page, label) {
  await page.locator(".view-chart-range-pill", { hasText: label }).click();
  await waitForChart(page);
}

async function waitForChart(page) {
  await page.waitForFunction(() => {
    const canvas = document.getElementById("viewPriceHistoryChart");
    const chart = canvas && window.Chart?.getChart(canvas);
    return Boolean(chart?.scales?.y && chart.data?.datasets?.length);
  });
}

async function chartSnapshot(page) {
  return page.evaluate(() => {
    const chart = Chart.getChart(document.getElementById("viewPriceHistoryChart"));
    const visibleDatasets = chart.data.datasets
      .filter((dataset) => dataset.hidden !== true)
      .map((dataset) => ({
        label: dataset.label,
        data: dataset.data.filter((value) => value !== null && Number.isFinite(Number(value))),
      }));

    return {
      yMin: chart.scales.y.min,
      yMax: chart.scales.y.max,
      suggestedMin: chart.options.scales.y.suggestedMin,
      suggestedMax: chart.options.scales.y.suggestedMax,
      labels: chart.data.labels,
      datasets: chart.data.datasets.map((dataset, index) => ({
        label: dataset.label,
        fill: dataset.fill,
        order: dataset.order,
        hidden: dataset.hidden === true,
        visible: chart.isDatasetVisible(index),
      })),
      visibleDatasets,
    };
  });
}

function expectVisibleDatasetsWithinScale(snapshot) {
  for (const dataset of snapshot.visibleDatasets) {
    for (const value of dataset.data) {
      expect(value).toBeGreaterThanOrEqual(snapshot.yMin);
      expect(value).toBeLessThanOrEqual(snapshot.yMax);
    }
  }
}

async function installYearFileStub(page) {
  const yearData = {
    2025: [yearEntry("2025-11-15", 66), yearEntry("2025-12-15", 67)],
    2026: [yearEntry("2026-01-15", 68), yearEntry("2026-03-15", 69), yearEntry("2026-05-10", 70)],
  };

  await page.evaluate((data) => {
    window.__strk42FetchedYears = [];
    window.fetchYearFile = async (year) => {
      window.__strk42FetchedYears.push(year);
      return (
        data[year] || [
          {
            timestamp: `${year}-01-10T12:00:00.000Z`,
            metal: "Silver",
            spot: 64,
            source: "year-file",
            provider: "Playwright",
          },
        ]
      );
    };
  }, yearData);
}

test.describe("view-modal-chart-scaling — STRK-42", () => {
  test("AC-1: low purchase price line gets padded below short-range melt values", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [{ ...BASE_ITEM, price: 38, marketValue: 75 }],
      spotHistory: makeSpotHistory(40, 70),
    });
    await gotoApp(page);
    await openViewModal(page);

    await clickRange(page, "7d");
    const snapshot = await chartSnapshot(page);

    expect(snapshot.suggestedMin).toBeLessThanOrEqual(36.1);
    expect(snapshot.yMin).toBeLessThanOrEqual(38);
    expectVisibleDatasetsWithinScale(snapshot);
  });

  test("AC-2: high purchase price line gets padded above short-range melt values", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [{ ...BASE_ITEM, price: 80, marketValue: 75 }],
      spotHistory: makeSpotHistory(40, 65),
    });
    await gotoApp(page);
    await openViewModal(page);

    await clickRange(page, "7d");
    const snapshot = await chartSnapshot(page);

    expect(snapshot.suggestedMax).toBeGreaterThan(80);
    expect(snapshot.yMax).toBeGreaterThanOrEqual(80);
    expectVisibleDatasetsWithinScale(snapshot);
  });

  test("AC-3/AC-4: 1Y range fetches bounded years and anchors line at the window start", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [{ ...BASE_ITEM, date: "2024-01-10", price: 38, marketValue: 75 }],
      spotHistory: [daysAgo(1, 70), daysAgo(0, 70)],
    });
    await gotoApp(page);
    await openViewModal(page);
    await installYearFileStub(page);

    await clickRange(page, "1Y");

    const snapshot = await chartSnapshot(page);
    const fetchedYears = await page.evaluate(() => window.__strk42FetchedYears);
    const firstLabel = snapshot.labels[0];

    expect(fetchedYears).toEqual([2025, 2026]);
    expect(String(Array.isArray(firstLabel) ? firstLabel.join(" ") : firstLabel)).toContain("May");
    expect(String(Array.isArray(firstLabel) ? firstLabel.join(" ") : firstLabel)).toContain("10");
    expectVisibleDatasetsWithinScale(snapshot);
  });

  test("regression: sparse 1Y range anchors at viewport start when purchase is inside range", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [{ ...BASE_ITEM, date: "2025-08-15", price: 38, marketValue: 75 }],
      spotHistory: [daysAgo(1, 70), daysAgo(0, 70)],
    });
    await gotoApp(page);
    await openViewModal(page);
    await installYearFileStub(page);

    await clickRange(page, "1Y");

    const snapshot = await chartSnapshot(page);
    const firstLabel = snapshot.labels[0];

    expect(String(Array.isArray(firstLabel) ? firstLabel.join(" ") : firstLabel)).toContain("May");
    expect(String(Array.isArray(firstLabel) ? firstLabel.join(" ") : firstLabel)).toContain("10");
    expectVisibleDatasetsWithinScale(snapshot);
  });

  test("AC-4/AC-5: wide ranges keep purchase, melt, and retail lines inside y-axis bounds", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [{ ...BASE_ITEM, price: 38, marketValue: 95 }],
      spotHistory: makeSpotHistory(220, 70),
    });
    await gotoApp(page);
    await openViewModal(page);
    await installYearFileStub(page);

    for (const range of ["5Y", "10Y", "Purchased", "All"]) {
      await clickRange(page, range);
      const snapshot = await chartSnapshot(page);
      expect(snapshot.suggestedMin).toBeLessThanOrEqual(38);
      expect(snapshot.suggestedMax).toBeGreaterThanOrEqual(95);
      expectVisibleDatasetsWithinScale(snapshot);
    }
  });

  test("AC-6: desktop and mobile chart containers remain legible while lines stay in bounds", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [{ ...BASE_ITEM, price: 38, marketValue: 95 }],
      spotHistory: makeSpotHistory(220, 70),
    });

    for (const viewport of [
      { width: 1280, height: 900, expectedChartHeight: 200 },
      { width: 390, height: 844, expectedChartHeight: 160 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoApp(page);
      await openViewModal(page);
      await installYearFileStub(page);

      for (const range of ["7d", "1Y", "All"]) {
        await clickRange(page, range);
        const snapshot = await chartSnapshot(page);
        expectVisibleDatasetsWithinScale(snapshot);
      }

      const chartBox = await page.locator(".view-chart-container canvas").boundingBox();
      expect(Math.round(chartBox.height)).toBe(viewport.expectedChartHeight);
      await page.screenshot({ clip: chartBox });
      await page.evaluate(() => window.closeViewModal?.());
    }
  });

  test("regression: initial render keeps purchase line above melt fill and avoids zero baseline", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [
        {
          ...BASE_ITEM,
          metal: "Gold",
          composition: "Gold",
          price: 3380,
          marketValue: 4694,
          date: "2025-08-15",
          purity: 1,
        },
      ],
      spotHistory: makeSpotHistory(40, 4694).map((entry) => ({ ...entry, metal: "Gold" })),
      retailHistory: {},
    });
    await gotoApp(page);
    await openViewModal(page);

    await clickRange(page, "7d");
    const snapshot = await chartSnapshot(page);
    const purchaseDataset = snapshot.datasets.find((dataset) => dataset.label === "Purchase Price");
    const meltDataset = snapshot.datasets.find((dataset) => dataset.label === "Melt Value");

    expect(purchaseDataset.visible).toBe(true);
    expect(purchaseDataset.fill).toBe(false);
    expect(purchaseDataset.order).toBeLessThan(meltDataset.order);
    expect(snapshot.yMin).toBeGreaterThan(3000);
    expect(snapshot.yMin).toBeLessThan(3380);
    expect(snapshot.yMax).toBeGreaterThan(4694);
    expectVisibleDatasetsWithinScale(snapshot);
  });
});

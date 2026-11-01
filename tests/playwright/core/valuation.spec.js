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

// A stack with buys inside and outside the 12 months before FIXED_NOW_ISO. Silver and Gold
// carry a dealer price, so retail and melt differ; Platinum has no buy in the window.
const STACK_ITEMS = [
  { ...BASE_ITEM, uuid: "stack-silver-old", date: "2024-03-01", qty: 5, price: 24, marketValue: 0 },
  {
    ...BASE_ITEM,
    uuid: "stack-silver-new",
    date: "2025-11-20",
    qty: 2,
    price: 31,
    marketValue: 90,
  },
  {
    ...SINGLE_GOLD,
    uuid: "stack-gold-new",
    date: "2026-02-01",
    weight: 0.1,
    price: 300,
    marketValue: 450,
  },
  {
    ...BASE_ITEM,
    uuid: "stack-platinum",
    metal: "Platinum",
    composition: "Platinum",
    date: "2024-06-01",
    price: 950,
    marketValue: 0,
  },
];

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

const STACK_SPOT_HISTORY = [
  ...makeSpotHistory(40, 70, "Silver"),
  ...makeSpotHistory(40, 4000, "Gold"),
  ...makeSpotHistory(40, 1000, "Platinum"),
];

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
  // One assertion per dataset: an expect() per point costs seconds on the "All" range.
  // NaN fails every comparison, so finiteness is checked explicitly on both sides.
  expect(Number.isFinite(snapshot.yMin) && Number.isFinite(snapshot.yMax)).toBe(true);
  for (const dataset of snapshot.datasets.filter((candidate) => candidate.visible)) {
    const outside = dataset.data.filter(
      (value) => !Number.isFinite(value) || value < snapshot.yMin || value > snapshot.yMax
    );
    expect(outside, `${dataset.label} values outside [${snapshot.yMin}, ${snapshot.yMax}]`).toEqual(
      []
    );
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

/** Reads the first money amount in an element's text, signed by a leading "-". */
async function readMoney(page, selector) {
  const text = (await page.locator(selector).textContent()) || "";
  const match = text.match(/(-?)\$([\d,]+\.\d{2})/);
  expect(match, `${selector} holds a money amount: "${text}"`).not.toBeNull();
  return `${match[1]}${match[2]}`;
}

test.describe("Dashboard stack headline", () => {
  test("matches the All Metals card to the cent and prices today's change from the 24h spot moves", async ({
    page,
  }) => {
    const seed = (await import("../../fixtures/seed-inventory.js")).default;
    await seedValuationData(page, {
      inventory: seed.metalInventory,
      spotHistory: [
        ...makeSpotHistory(5, 70, "Silver"),
        daysAgo(0, 72, "Silver"),
        ...makeSpotHistory(5, 4000, "Gold"),
        daysAgo(0, 4100, "Gold"),
      ],
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.appListenersReady === true);
    // One card: one heading, the figures, then the ledger, which keeps its own name.
    const card = page.locator("#totalsSectionEl");
    await expect(card).toBeVisible();
    await expect(card.locator("h2")).toHaveText(["Your stack"]);
    await expect(card.locator("#stackHeadlineFigures")).toBeVisible();
    await expect(card.getByRole("table", { name: "Totals by metal" })).toBeVisible();
    await expect(page.locator("#stackHeadlineFigures dt")).toHaveText([
      "Retail value",
      "Melt value",
      "Gain on cost",
      "Cost basis",
      "Realized",
    ]);

    await expect.poll(() => readMoney(page, "#stackRetailValue")).not.toBe("0.00");
    const matches = {
      "#stackRetailValue": "#retailValueAll",
      "#stackMeltValue": "#currentValueAll",
      "#stackGainValue": "#lossProfitAll",
      "#stackCostValue": "#totalPurchasedAll",
      "#stackRealizedValue": "#realizedGainLossAll",
    };
    for (const [figure, cell] of Object.entries(matches)) {
      expect(await readMoney(page, figure), figure).toBe(await readMoney(page, cell));
    }
    await expect(page.locator("#stackGainSub")).toHaveText(
      `${await page.locator("#lossProfitAll .gain-loss-pct").textContent()} at retail`
    );
    // Ounces of different metals do not sum to a figure, so the headline shows none.
    await expect(page.locator("#stackMeltSub")).toHaveText(
      `${await page.locator("#totalItemsAll").textContent()} Items, priced at spot`
    );
    const figureText = await page.locator("#stackHeadlineFigures").evaluate((el) => el.innerText);
    expect(figureText).not.toMatch(/\d oz\b/);
    await expect(page.locator("#stackCostSub")).toHaveText(
      `Avg ${await page.locator("#avgCostPerOzAll").textContent()}/oz`
    );

    // Realized follows the Show Realized setting, in the figures and in the ledger.
    await page.evaluate(() => applyRealizedVisibility(false));
    await expect(page.locator("#stackRealizedFigure")).toBeHidden();
    await expect(page.locator("#realizedGainLossAll")).toBeHidden();
    await page.evaluate(() => applyRealizedVisibility(true));
    await expect(page.locator("#stackRealizedFigure")).toBeVisible();

    // Each Item's pure ounces (melt / current spot) priced at the two prices the 24h
    // comparison uses, summed over the active Items.
    const handTodayChange = () =>
      page.evaluate(() => {
        const moved = {};
        let change = 0;
        for (const item of inventory.filter((i) => !isDisposed(i))) {
          const key = item.metal.toLowerCase();
          const day = (moved[key] ??= get24hChange(item.metal));
          if (!day.valid || !(spotPrices[key] > 0)) continue;
          const pureOz = computeItemValuation(item, spotPrices[key]).meltValue / spotPrices[key];
          change += pureOz * (day.newPrice - day.oldPrice);
        }
        const seeded = ["silver", "gold"].every((key) => moved[key]?.valid && moved[key].pct !== 0);
        const sign = change > 0 ? "" : "-";
        const amount = formatCurrency(Math.abs(change)).replace(/^[^\d]*/, "");
        return { seeded, money: `${sign}${amount}` };
      });
    const expected = await handTodayChange();
    expect(expected.seeded, "silver and gold have a 24h change").toBe(true);
    expect(await readMoney(page, "#stackTodayValue")).toBe(expected.money);
    // Under the retail lead, the line names its basis: it is a change at spot.
    await expect(page.locator("#stackTodayValue")).toContainText(/today at spot$/);

    // A history pull redraws the sparklines through updateAllSparklines, and Today follows.
    // The new close goes on the newest history day, whichever source supplied it.
    await page.evaluate(async () => {
      const newest = spotHistory
        .filter((e) => e.metal === "Gold")
        .reduce((a, b) => (new Date(a.timestamp) > new Date(b.timestamp) ? a : b));
      spotHistory.push({
        timestamp: `${newest.timestamp.slice(0, 10)}T23:00:00.000Z`,
        metal: "Gold",
        spot: 4300,
        source: "seed",
        provider: "Playwright",
      });
      await updateAllSparklines();
    });
    const afterPull = await handTodayChange();
    expect(afterPull.money).not.toBe(expected.money);
    expect(await readMoney(page, "#stackTodayValue")).toBe(afterPull.money);

    // Demo Items without a retail price count at melt, with no footnote under the figures.
    await expect(page.locator("#stackRetailLabel")).toHaveText("Retail value");
    await expect(page.locator("#stackRetailValue")).not.toHaveAttribute("aria-describedby", /./);
    await expect(card).not.toContainText("no retail price");

    // With no Items the card offers Add Item, and the ledger has no row to show.
    await page.evaluate(() => {
      inventory.length = 0;
      updateSummary();
    });
    await expect(card).toContainText("No Items yet.");
    await expect(page.locator("#totalsLedger")).toBeHidden();
  });

  test("the lead swaps between retail and melt by keyboard, follows the gain and survives a reload", async ({
    page,
  }) => {
    await seedValuationData(page, { inventory: STACK_ITEMS, spotHistory: STACK_SPOT_HISTORY });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.appListenersReady === true);
    const figures = page.locator("#stackHeadlineFigures");
    const swap = page.getByRole("button", { name: /^Lead with/ });
    await expect(swap).toHaveAccessibleName("Lead with melt value");
    await expect.poll(() => readMoney(page, "#stackRetailValue")).not.toBe("0.00");
    await expect(page.locator("#stackRetailSub")).toBeHidden();
    // The PDF names the gain's basis on each of its four metal blocks.
    const pdfGainBases = () =>
      page.evaluate(() =>
        [
          ..._buildInventoryPdf()
            .output()
            .matchAll(/Gain\/Loss \\\(at (\w+)\\\)/g),
        ].map((match) => match[1])
      );
    expect(await pdfGainBases()).toEqual(Array(4).fill("retail"));
    const retailBefore = await readMoney(page, "#retailValueAll");
    const meltBefore = await readMoney(page, "#currentValueAll");

    await swap.focus();
    await page.keyboard.press("Enter");
    await expect(figures.locator("dt")).toHaveText([
      "Melt value",
      "Retail value",
      "Gain on cost",
      "Cost basis",
      "Realized",
    ]);
    await expect(swap).toBeFocused();
    await expect(swap).toHaveAccessibleName("Lead with retail value");

    // The lead figure is first in DOM order, carries today's line in the large type, and
    // the button sits in its label.
    const lead = figures.locator(".stack-figure").first();
    await expect(lead.locator("dt")).toHaveText("Melt value");
    await expect(lead.locator("#stackTodayValue")).toHaveText(/today$/);
    await expect(lead.locator("dt button")).toHaveCount(1);
    const fontSize = (selector) =>
      page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await fontSize("#stackMeltValue")).toBeGreaterThan(await fontSize("#stackRetailValue"));
    await expect(page.locator("#stackMeltSub")).toBeHidden();
    await expect(page.locator("#stackRetailSub")).toHaveText(/^[+-]\d+\.\d% over melt$/);

    // Gain on cost at melt: the ledger's All Metals melt minus its cost basis. The ledger's
    // Gain/Loss column follows the lead, and its value columns stay as they were.
    const gainAtMelt = (row) =>
      page.evaluate((name) => {
        const money = (id) =>
          Number(document.getElementById(id).textContent.replace(/[^\d.-]/g, ""));
        const gain = money(`currentValue${name}`) - money(`totalPurchased${name}`);
        return `${gain < 0 ? "-" : ""}${formatCurrency(Math.abs(gain)).replace(/^[^\d]*/, "")}`;
      }, row);
    const meltGain = await gainAtMelt("All");
    expect(await readMoney(page, "#stackGainValue")).toBe(meltGain);
    await expect(page.locator("#stackGainSub")).toHaveText(/^[+-]\d+\.\d% at melt$/);
    await expect.poll(() => readMoney(page, "#lossProfitAll")).toBe(meltGain);
    await expect(page.locator("#stackGainSub")).toHaveText(
      `${await page.locator("#lossProfitAll .gain-loss-pct").textContent()} at melt`
    );
    expect(await readMoney(page, "#lossProfitSilver")).toBe(await gainAtMelt("Silver"));
    expect(await pdfGainBases()).toEqual(Array(4).fill("melt"));
    expect(await readMoney(page, "#retailValueAll")).toBe(retailBefore);
    expect(await readMoney(page, "#currentValueAll")).toBe(meltBefore);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.appListenersReady === true);
    await expect(figures.locator("dt").first()).toHaveText("Melt value");
    await expect.poll(() => readMoney(page, "#lossProfitAll")).toBe(meltGain);

    await swap.focus();
    await page.keyboard.press("Space");
    await expect(figures.locator("dt").first()).toHaveText("Retail value");
    await expect(swap).toBeFocused();
    await expect(page.locator("#stackGainSub")).toHaveText(/ at retail$/);
    expect(await readMoney(page, "#lossProfitAll")).toBe(await readMoney(page, "#stackGainValue"));

    // A write that fails for a reason other than a full store says so; the lead stays.
    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "stackHeadlineLead") throw new Error("write blocked");
        return setItem.call(this, key, value);
      };
    });
    await swap.click();
    await expect(page.locator(".cloud-toast")).toHaveText(
      "Could not save the lead figure. Swap it again to retry."
    );
    await expect(figures.locator("dt").first()).toHaveText("Retail value");
  });

  test("the gain label reads Loss on cost below zero, across a swap and a spot change", async ({
    page,
  }) => {
    await seedValuationData(page, { inventory: STACK_ITEMS, spotHistory: STACK_SPOT_HISTORY });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.appListenersReady === true);
    await expect.poll(() => readMoney(page, "#stackRetailValue")).not.toBe("0.00");
    const label = page.locator("#stackGainLabel");
    await expect(page.locator("#totalsLedger thead .totals-col-gain")).toHaveText("Gain/Loss");

    // Cost basis halfway between melt and retail: a gain at retail and a loss at melt.
    await page.evaluate(() => {
      const figures = computeStackHeadline(_lastMetalTotals, () => null);
      const factor = (figures.melt + figures.retail) / 2 / figures.purchased;
      if (!(figures.retail > figures.melt)) throw new Error("the seed needs retail above melt");
      inventory.forEach((item) => {
        item.price *= factor;
      });
      updateSummary();
    });
    await expect(label).toHaveText("Gain on cost");
    await page.locator("#stackLeadSwap").click();
    await expect(label).toHaveText("Loss on cost");
    await expect(page.locator("#stackGainValue")).toHaveText(/^-/);

    await page.evaluate(() => {
      spotPrices.silver *= 10;
      updateSummary();
    });
    await expect(label).toHaveText("Gain on cost");

    // A gain of exactly zero reads as a gain.
    await page.evaluate(() => {
      const figures = computeStackHeadline(_lastMetalTotals, () => null);
      const factor = figures.melt / figures.purchased;
      inventory.forEach((item) => {
        item.price *= factor;
      });
      updateSummary();
    });
    await expect(label).toHaveText("Gain on cost");
  });

  test("the weights list matches the ledger and the 12-month line matches the breakdown modal at 1Y", async ({
    page,
  }) => {
    await seedValuationData(page, { inventory: STACK_ITEMS, spotHistory: STACK_SPOT_HISTORY });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.appListenersReady === true);

    // One row per held metal in Metal Order; Palladium and Copper hold nothing.
    const rows = page.locator("#stackWeights li");
    await expect(rows.locator(".stack-weight-name")).toHaveText(["Silver", "Gold", "Platinum"]);

    // The Rate header sits over the pace column and names the measure in full.
    const rate = page.locator("#stackWeightsRate");
    await expect(rate).toBeVisible();
    await expect(rate).toHaveAttribute("title", "12-month buying rate");
    await expect(rate.locator(".sr-only")).toHaveText("12-month buying rate");
    await expect(rate.locator("[aria-hidden]")).toHaveText("Rate");
    const rightEdge = (locator) => locator.evaluate((el) => el.getBoundingClientRect().right);
    await expect
      .poll(async () =>
        Math.abs(
          (await rightEdge(rate)) - (await rightEdge(rows.first().locator(".stack-weight-pace")))
        )
      )
      .toBeLessThanOrEqual(1);
    for (const name of ["Silver", "Gold", "Platinum"]) {
      const row = rows.filter({ hasText: name });
      const ledgerOz = await page.locator(`#totalWeight${name}`).textContent();
      await expect(row.locator(".stack-weight-oz")).toHaveText(`${ledgerOz} oz`);
    }

    /** Reads the breakdown modal's 1Y strip for a scope. */
    const modalStrip = async (scope) => {
      await page.evaluate((s) => window.showDetailsModal(s), scope);
      await expect(page.locator("#dmSubstrip2 span").first()).toBeVisible();
      const strip = await page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll("#dmSubstrip2 span")].map((span) => [
            span.firstChild.textContent.trim(),
            span.querySelector("strong").textContent,
          ])
        )
      );
      await page.evaluate(() => window.closeDetailsModal());
      return strip;
    };

    for (const name of ["Silver", "Gold", "Platinum"]) {
      const { pace } = await modalStrip(name);
      const expected = pace === "0.000 oz/mo" ? "No buys" : `+${pace}`;
      await expect(rows.filter({ hasText: name }).locator(".stack-weight-pace")).toHaveText(
        expected
      );
    }
    await expect(rows.filter({ hasText: "Platinum" }).locator(".stack-weight-pace")).toHaveText(
      "No buys"
    );

    const all = await modalStrip("All");
    expect(all.acquisitions).toBe("2");
    await expect(page.locator("#stackActivity")).toHaveText(
      `Last 12 months: ${all.invested.split(" (")[0]} added across ${all.acquisitions} acquisitions, market ${all.market}`
    );

    // The series values today at live spot, so a spot move redraws the market figure with
    // the inventory unchanged, and it still matches the breakdown modal.
    await page.evaluate(() => {
      spotPrices.silver *= 1.25;
      updateSummary();
    });
    const moved = await modalStrip("All");
    expect(moved.market).not.toBe(all.market);
    await expect(page.locator("#stackActivity")).toHaveText(
      `Last 12 months: ${moved.invested.split(" (")[0]} added across ${moved.acquisitions} acquisitions, market ${moved.market}`
    );

    // A spot history import redraws through updateAllSparklines. A corrected close on the
    // day before the window moves its baseline, so the market figure follows it.
    await page.evaluate(async () => {
      for (const day of ["2025-05-08", "2025-05-09", "2025-05-10"]) {
        spotHistory.push({
          timestamp: `${day}T20:00:00.000Z`,
          metal: "Silver",
          spot: 5,
          source: "seed",
          provider: "Playwright",
        });
      }
      await updateAllSparklines();
    });
    const corrected = await modalStrip("All");
    expect(corrected.market).not.toBe(moved.market);
    await expect(page.locator("#stackActivity")).toHaveText(
      `Last 12 months: ${corrected.invested.split(" (")[0]} added across ${corrected.acquisitions} acquisitions, market ${corrected.market}`
    );

    // Phones: the weights list and the activity line wrap below the figures.
    await page.setViewportSize({ width: 390, height: 844 });
    const bottomOf = (selector) =>
      page.locator(selector).evaluate((el) => el.getBoundingClientRect().bottom);
    const topOf = (selector) =>
      page.locator(selector).evaluate((el) => el.getBoundingClientRect().top);
    await expect
      .poll(
        async () => (await topOf("#stackActivity")) >= (await bottomOf("#stackHeadlineFigures"))
      )
      .toBe(true);
    await expect
      .poll(async () => (await topOf("#stackWeights")) >= (await bottomOf("#stackActivity")))
      .toBe(true);
    await page.getByRole("button", { name: "Lead with melt value" }).click();
    await expect(page.locator("#stackHeadlineFigures dt").first()).toHaveText("Melt value");
  });

  test("a damaged inventory under recovery shows no Add Item prompt", async ({ page }) => {
    // Saving an Item from the prompt would clear the recovery hold and overwrite the
    // damaged inventory, so the headline stays blank like the table's empty state.
    await page.addInitScript(() => {
      localStorage.setItem("metalInventory", "{not valid json");
      document.addEventListener(
        "DOMContentLoaded",
        () => localStorage.setItem("ackVersion", APP_VERSION),
        { once: true }
      );
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.appListenersReady === true);
    await expect(page.locator("#inventoryRecoveryBanner")).toBeVisible();
    await expect(page.locator("#stackHeadlineEmpty")).toBeHidden();
    await expect(page.locator("#stackHeadlineAddItem")).toBeHidden();
    await expect(page.locator("#stackHeadlineFigures")).toBeHidden();
  });

  test("an empty inventory offers Add Item, which opens the add form on Inventory", async ({
    page,
  }) => {
    await seedValuationData(page, { inventory: [] });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.appListenersReady === true);
    const headline = page.locator("#totalsSectionEl");
    await expect(headline).toContainText("No Items yet.");
    await expect(page.locator("#stackRetailValue")).toBeHidden();

    await headline.getByRole("button", { name: "Add Item" }).click();
    await expect(page.locator("#tabBtnInventory")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#itemModal")).toBeVisible();
  });
});

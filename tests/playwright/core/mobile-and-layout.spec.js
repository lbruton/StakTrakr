import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";
import { installStakTrakrNetworkMocks } from "../helpers/mocks/routes.js";

const BASE_ITEM = {
  uuid: "core-mobile-layout-item",
  metal: "Silver",
  composition: "Silver",
  name: "Core Mobile Layout Item",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 35,
  marketValue: 0,
  date: "2026-04-25",
  purchaseLocation: "StakTrakr",
  storageLocation: "Safe",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 32,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
  numistaData: { shape: "rectangular", composition: "Silver (.999)", length: 51, width: 89 },
  capsule: "Air-Tite A40",
};

const BULK_ITEMS = [
  BASE_ITEM,
  {
    ...BASE_ITEM,
    uuid: "core-mobile-layout-round",
    name: "Core Mobile Layout Round",
    serial: 2,
    numistaData: { shape: "round", composition: "Silver (.999)", diameter: 40.6 },
  },
];

async function seedInventory(page, items = [BASE_ITEM]) {
  await page.addInitScript((inventory) => {
    localStorage.setItem("metalInventory", JSON.stringify(inventory));
    localStorage.setItem("inventorySerial", String(inventory.length + 10));
    localStorage.setItem("itemTags", JSON.stringify({}));
    localStorage.setItem("cardViewStyle", "A");
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  }, items);
}

async function gotoApp(page) {
  // Deep-link into the Inventory tab (STRK-282): #newItemBtn lives in that
  // panel, and the v2 shell boots on Dashboard, so a bare /index.html leaves
  // this control display:none.
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.openBulkEdit === "function" &&
      typeof window.editItem === "function" &&
      typeof window.showViewModal === "function" &&
      typeof window.resolveImageFrame === "function" &&
      Array.isArray(window.inventory)
  );
}

async function openBulkEdit(page) {
  await page.evaluate(() => window.openBulkEdit());
  await expect(page.locator("#bulkEditModal")).toBeVisible();
  await page.waitForSelector("#bulkEditModal .bulk-edit-table tbody tr[data-serial]", {
    state: "attached",
  });
}

async function openEditModal(page, index = 0) {
  await page.evaluate((idx) => window.editItem(idx), index);
  await expect(page.locator("#itemModal")).toBeVisible();
}

async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

async function findRuleCssText(page, selector) {
  return page.evaluate((sel) => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (_e) {
        continue;
      }
      for (const rule of Array.from(rules || [])) {
        if (rule instanceof CSSStyleRule && rule.selectorText === sel) return rule.cssText;
      }
    }
    return null;
  }, selector);
}

test.describe("core/mobile-and-layout", () => {
  test("bulk editor opens on mobile and exposes catalog/capsule fields without raw JSON columns", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedInventory(page, BULK_ITEMS);
    await gotoApp(page);
    await openBulkEdit(page);

    await expect(page.locator("#bulkEditModal .bulk-edit-table")).toBeVisible();
    await expect(page.locator("#bulkField_shape")).toHaveCount(1);
    await expect(page.locator("#bulkField_capsule")).toHaveCount(1);
    await expect(page.locator("#bulkField_capsuleNotes")).toHaveCount(1);

    const headerTexts = await page
      .locator("#bulkEditModal .bulk-edit-table thead th")
      .allTextContents();
    expect(headerTexts.some((text) => /^\s*Numista Data\s*$/i.test(text))).toBe(false);
    expect(headerTexts).toContain("Catalog Composition");
    expect(headerTexts).toContain("Diameter");
  });

  test("mobile modal safe-area rules and viewport-fit cover remain wired", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);

    expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain(
      "viewport-fit=cover"
    );

    await openViewModal(page);
    expect(await findRuleCssText(page, ".view-modal-footer")).toContain(
      "env(safe-area-inset-bottom"
    );
    await page.evaluate(() => window.closeViewModal?.());

    await openEditModal(page);
    expect(await findRuleCssText(page, "#inventoryForm .item-modal-actions")).toContain(
      "env(safe-area-inset-bottom"
    );
  });

  test("edit modal keeps image, identity, metal, and denomination controls in order", async ({
    page,
  }) => {
    await seedInventory(page, [BASE_ITEM]);
    await gotoApp(page);
    await openEditModal(page);

    const order = await page.evaluate(() => {
      const form = document.getElementById("inventoryForm");
      const indexOf = (selector) =>
        Array.from(form.children).indexOf(document.querySelector(selector));
      return {
        image: indexOf("#imageUploadGroup"),
        nameYear: indexOf("#inventoryForm > .grid-name-year"),
        purityQtyWeight: indexOf("#inventoryForm > .grid-purity-row"),
      };
    });
    // STRK-434: the Images section sits below Type, Metal and Name, as in the Edit collection builder.
    expect(order.nameYear).toBeLessThan(order.image);
    expect(order.image).toBeLessThan(order.purityQtyWeight);

    await page.waitForFunction(
      () =>
        typeof toggleGbDenomPicker === "function" && document.getElementById("itemGbDenom") !== null
    );
    await page.selectOption("#itemWeightUnit", "gb");
    await expect(page.locator("#itemWeightLabel")).toHaveText("DENOMINATION");
    await expect(page.locator("#itemGbDenom")).toBeVisible();
  });

  test("image frame resolver and compact card/table rendering preserve rectangular items", async ({
    page,
  }) => {
    await seedInventory(page, [
      { ...BASE_ITEM, type: "Bar", obverseImageUrl: "https://images.example/obv.png" },
    ]);
    await page.route("https://images.example/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"></svg>',
      });
    });
    await gotoApp(page);

    const frames = await page.evaluate(() => ({
      explicitRect: window.resolveImageFrame(
        { type: "Coin", obverseImageFrame: "rectangle", numistaData: { shape: "round" } },
        "obverse"
      ),
      grading: window.resolveImageFrame({ type: "Coin", gradingAuthority: "PCGS" }, "obverse"),
      fallback: window.resolveImageFrame(
        { type: "Coin", numistaData: { shape: "round" } },
        "obverse"
      ),
    }));
    expect(frames).toEqual({ explicitRect: "rect", grading: "rect", fallback: "round" });

    await expect(page.locator(".card-a .coin-img.bar-shape").first()).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)"
    );
    await page.evaluate(() => {
      localStorage.setItem("cardViewStyle", "B");
      window.renderTable();
    });
    await expect(page.locator(".card-b .coin-img.bar-shape").first()).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)"
    );
  });
});

// ── STRK-352: metal detail modal — responsive contract (AC-20/22/23) ────────
// Written RED in Cohort B: the Variant A shell does not exist yet. The modal
// opens from the DASHBOARD totals cards, so this block boots without the
// #/inventory deep-link the suites above need.
test.describe("detail modal — mobile", () => {
  const DM_ITEMS = [
    {
      ...BASE_ITEM,
      uuid: "dm-mob-1",
      name: "Mobile Silver Bar",
      weight: 2,
      price: 50,
      date: "2026-08-01",
    },
    {
      ...BASE_ITEM,
      uuid: "dm-mob-2",
      name: "Mobile Maple",
      serial: 2,
      price: 30,
      date: "2026-07-01",
    },
  ];

  /**
   * Opens the detail modal on a mobile viewport for the seeded Silver items.
   * @param {import('@playwright/test').Page} page
   * @returns {Promise<void>}
   */
  async function openMobileModal(page) {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedInventory(page, DM_ITEMS);
    await page.addInitScript(() => {
      localStorage.setItem("spotSilver", "10");
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.appListenersReady === true);
    await page.click('.total-title[data-metal="Silver"]');
    await expect(page.locator("#detailsModal")).toBeVisible();
    await page.waitForFunction(() => {
      const c = document.getElementById("dmHeroChart");
      return !!(c && window.Chart && window.Chart.getChart(c));
    });
  }

  test("AC-22: the hero chart canvas renders on mobile (STACK-70 reversal)", async ({ page }) => {
    await openMobileModal(page);
    const canvas = page.locator("#dmHeroChart");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(200);
    // the metric toggle must not be display:none'd by the old mobile rules
    await expect(page.locator("#detailsModal .chart-metric-toggle").first()).toBeVisible();
  });

  test("AC-23: layout stacks to one column with a two-column KPI strip", async ({ page }) => {
    await openMobileModal(page);
    const kpis = page.locator("#detailsModal .dm-kpi");
    const first = await kpis.nth(0).boundingBox();
    const second = await kpis.nth(1).boundingBox();
    const third = await kpis.nth(2).boundingBox();
    expect(Math.abs(first.y - second.y)).toBeLessThan(2); // same row
    expect(third.y).toBeGreaterThan(first.y + 10); // wrapped to row 2
    // composition column and ledger stack vertically (single grid column)
    const comp = await page.locator("#detailsModal .dm-panel").first().boundingBox();
    const ledger = await page.locator("#detailsModal .dm-ledger").boundingBox();
    expect(ledger.y).toBeGreaterThan(comp.y + comp.height - 2);
  });

  test("AC-20: the mobile ledger slims to Date | Item | Qty | ±%", async ({ page }) => {
    await openMobileModal(page);
    const headers = page.locator("#detailsModal .dm-ledger thead th");
    const visible = [];
    const n = await headers.count();
    for (let i = 0; i < n; i++) {
      if (await headers.nth(i).isVisible()) visible.push((await headers.nth(i).innerText()).trim());
    }
    expect(visible.map((t) => t.toLowerCase())).toEqual(["date", "item", "qty", "±%"]);
    // paid / melt cells hidden, not merely narrow
    await expect(page.locator("#detailsModal .dm-ledger td.dm-col-paid").first()).toBeHidden();
    await expect(page.locator("#detailsModal .dm-ledger td.dm-col-melt").first()).toBeHidden();
  });
});

/**
 * Boots the Dashboard at a phone width with the seed inventory, a theme, and prices whose
 * full text is wider than a two-column card. `copper` adds a copper holding after the seed.
 */
async function gotoPhoneDashboard(page, { width = 390, theme = "light", copper = false } = {}) {
  await page.setViewportSize({ width, height: 844 });
  await installStakTrakrNetworkMocks(page, {
    spotLatest: { xau: { price: 4123.45 }, xpd: { price: 1045.67 } },
  });
  await injectSeedInventory(page);
  if (copper) await addCopperHolding(page);
  await page.addInitScript((t) => localStorage.setItem("appTheme", t), theme);
  await page.goto("/index.html");
  await expect(page.locator("#bestPriceTickerEl .ticker-track")).toHaveCount(1);
  await expect(page.locator("#spotPriceDisplayGold")).toContainText("4,123.45");
}

/** Enables copper in Metal Order and adds one copper Item, so the ledger holds five metals. */
async function addCopperHolding(page) {
  await page.addInitScript(() => {
    const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
    inv.push({
      uuid: "ledger-copper-round",
      metal: "Copper",
      composition: "Copper",
      name: "Copper Round",
      qty: 2,
      type: "Round",
      weight: 1,
      weightUnit: "oz",
      price: 4,
      marketValue: 0,
      date: "2026-04-25",
      purity: 0.999,
      serial: 9001,
    });
    localStorage.setItem("metalInventory", JSON.stringify(inv));
    localStorage.setItem(
      "metalOrderConfig",
      JSON.stringify(
        ["all", "silver", "gold", "platinum", "palladium", "copper"].map((id) => ({
          id,
          label: id,
          enabled: true,
        }))
      )
    );
  });
}

/** Lists the visible metal rows of the totals ledger by metal key, in rendered order. */
function visibleLedgerRows(page) {
  return page
    .locator("#totalsLedger tbody .totals-row")
    .evaluateAll((rows) =>
      rows.filter((r) => r.getClientRects().length > 0).map((r) => r.dataset.metalKey)
    );
}

test.describe("Dashboard totals ledger", () => {
  test("one table: a row per held metal in Metal Order, All Metals as the footer, aligned figures, one frame", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await injectSeedInventory(page);
    await page.goto("/index.html");
    const ledger = page.locator("#totalsLedger");
    await expect(ledger).toBeVisible();
    expect(await ledger.evaluate((el) => el.tagName)).toBe("TABLE");
    await expect
      .poll(() => visibleLedgerRows(page))
      .toEqual(["silver", "gold", "platinum", "palladium"]);
    await expect(page.locator("#totalsLedger tfoot .total-title")).toHaveText("All Metals");
    await expect(page.locator("#totalsLedger thead th")).toHaveText([
      "Metal",
      "Items",
      "Weight (oz)",
      "Avg cost/oz",
      "Paid",
      "Melt",
      "Retail",
      "Gain",
      "Realized",
    ]);
    await expect(page.locator("#totalsDots, #totalsPrev, #totalsNext, .total-card")).toHaveCount(0);

    const layout = await page.evaluate(() => {
      const cells = [...document.querySelectorAll("#totalsLedger .total-value")].filter(
        (c) => c.getClientRects().length > 0
      );
      const melt = cells.filter((c) => c.classList.contains("totals-col-melt"));
      const rights = melt.map((c) => Math.round(c.getBoundingClientRect().right));
      const section = document.getElementById("totalsSectionEl");
      const framed = [...section.querySelectorAll("*")].filter((el) => {
        const s = getComputedStyle(el);
        return (
          el.getClientRects().length > 0 &&
          ["Top", "Right", "Bottom", "Left"].every(
            (side) => parseFloat(s[`border${side}Width`]) > 0
          ) &&
          parseFloat(s.borderTopLeftRadius) > 0
        );
      });
      return {
        notTabular: cells
          .filter((c) => !getComputedStyle(c).fontVariantNumeric.includes("tabular-nums"))
          .map((c) => c.id),
        notRight: cells.filter((c) => getComputedStyle(c).textAlign !== "right").map((c) => c.id),
        meltRows: melt.length,
        meltRightEdges: new Set(rights).size,
        sectionShadow: getComputedStyle(section).boxShadow,
        nestedFrames: framed.map((el) => el.id || el.className),
      };
    });
    expect(layout).toEqual({
      notTabular: [],
      notRight: [],
      meltRows: 5,
      meltRightEdges: 1,
      sectionShadow: "none",
      nestedFrames: [],
    });
  });

  test("a metal keeps its row for active Items or a realized gain, not for a gift alone", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const item = (uuid, metal, disposition) => ({
        uuid,
        metal,
        composition: metal,
        name: `${metal} Round`,
        qty: 1,
        type: "Round",
        weight: 1,
        weightUnit: "oz",
        price: 30,
        marketValue: 0,
        date: "2026-04-25",
        purity: 0.999,
        ...(disposition ? { disposition } : {}),
      });
      localStorage.setItem(
        "metalInventory",
        JSON.stringify([
          item("ledger-silver", "Silver"),
          item("ledger-gold-sold", "Gold", {
            type: "sold",
            date: "2026-05-01",
            amount: 60,
            realizedGainLoss: 30,
          }),
          item("ledger-platinum-gift", "Platinum", {
            type: "gifted",
            date: "2026-05-01",
            amount: 0,
            realizedGainLoss: 0,
          }),
        ])
      );
    });
    await page.goto("/index.html");
    await expect.poll(() => visibleLedgerRows(page)).toEqual(["silver", "gold"]);
    await expect(page.locator("#realizedGainLossGold")).toContainText("30");
  });

  test("five held metals fit at 1440 without scrolling sideways", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await injectSeedInventory(page);
    await addCopperHolding(page);
    await page.goto("/index.html");
    await expect
      .poll(() => visibleLedgerRows(page))
      .toEqual(["silver", "gold", "platinum", "palladium", "copper"]);
    await expect(page.locator("#totalItemsCopper")).toHaveText("2");
    const overflow = await page.evaluate(() => {
      const section = document.getElementById("totalsSectionEl");
      return {
        section: section.scrollWidth - section.clientWidth,
        page: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(overflow).toEqual({ section: 0, page: 0 });
  });
});

/**
 * Reads the background of each Dashboard frame, which of the header, ticker and footer cast a
 * shadow, and the colour each ticker fade starts from.
 */
function readDashboardFrames(page) {
  return page.evaluate(() => {
    const frames = {
      header: document.querySelector(".app-header"),
      spot: document.querySelector('.spot-card[data-metal="silver"]'),
      ticker: document.getElementById("bestPriceTickerEl"),
      stack: document.querySelector(".stack-headline"),
      totals: document.getElementById("totalsSectionEl"),
      footer: document.querySelector(".app-footer"),
    };
    const ticker = frames.ticker;
    // A gradient serialises its first stop first, so the fade start is the first colour.
    const fadeStart = (pseudo) =>
      getComputedStyle(ticker, pseudo).backgroundImage.match(/(?:oklch|rgba?)\([^)]*\)/)?.[0];
    return {
      backgrounds: Object.fromEntries(
        Object.entries(frames).map(([k, el]) => [k, getComputedStyle(el).backgroundColor])
      ),
      shadowed: ["header", "ticker", "footer"].filter(
        (k) => getComputedStyle(frames[k]).boxShadow !== "none"
      ),
      fades: [fadeStart("::before"), fadeStart("::after")],
    };
  });
}

test.describe("Dashboard frames", () => {
  test("header, spot cards, ticker, stack, totals and footer share one surface in every theme", async ({
    page,
  }) => {
    const themes = ["light", "dark", "slate", "sepia"];
    test.setTimeout(test.info().timeout * themes.length);
    await page.setViewportSize({ width: 1440, height: 900 });
    await injectSeedInventory(page);
    for (const theme of themes) {
      await test.step(theme, async () => {
        await page.goto("about:blank");
        await page.addInitScript((t) => localStorage.setItem("appTheme", t), theme);
        await page.goto("/index.html");
        await expect(page.locator("#bestPriceTickerEl .ticker-track")).toHaveCount(1);
        await expect
          .poll(async () => {
            const { backgrounds, shadowed, fades } = await readDashboardFrames(page);
            return {
              colours: [...new Set(Object.values(backgrounds))].length,
              shadowed,
              fadesMatch: fades.every((f) => f === backgrounds.ticker),
            };
          })
          .toEqual({ colours: 1, shadowed: [], fadesMatch: true });
      });
    }
  });
});

/** Lists the spot cards, labels and values whose text is cut off inside their own box. */
function readClippedText(page) {
  return page.evaluate(() => {
    const selector = [
      ".stack-figure-label",
      ".stack-figure-value",
      ".spot-card",
      ".spot-card-label",
      ".spot-card-value",
      ".spot-card-change",
      ".spot-ratio-chip",
      ".spot-card-timestamp",
      ".total-title",
      ".total-value",
    ].join(", ");
    return [...document.querySelectorAll(`#tabViewDashboard :is(${selector})`)]
      .filter((el) => el.getClientRects().length > 0)
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => getComputedStyle(el).overflow !== "visible")
      .map((el) => `${el.id || el.className}: ${el.textContent.trim().slice(0, 40)}`);
  });
}

test.describe("Dashboard at phone width", () => {
  test("spot prices, labels and totals values show in full at 390 and 320 in every theme", async ({
    page,
  }) => {
    const cases = [390, 320].flatMap((width) =>
      ["light", "dark", "slate", "sepia"].map((theme) => ({ width, theme }))
    );
    test.setTimeout(test.info().timeout * cases.length);
    for (const { width, theme } of cases) {
      await test.step(`${width}px ${theme}`, async () => {
        await page.goto("about:blank");
        await gotoPhoneDashboard(page, { width, theme });
        const gold = page.locator("#spotPriceDisplayGold");
        const expected = await page.evaluate(() => formatSpotCardValue("gold", 4123.45));
        await expect(gold).toContainText(expected);
        await expect(page.locator("#stackRetailValue")).toBeVisible();
        await expect(page.locator(".spot-card[data-metal='gold'] .spot-card-label")).toHaveText(
          /^gold$/i,
          { useInnerText: true }
        );
        await expect.poll(() => readClippedText(page)).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        ).toBeLessThanOrEqual(0);
      });
    }
  });

  test("each held metal in the totals ledger is one two-line block at 390 and 320", async ({
    page,
  }) => {
    test.setTimeout(test.info().timeout * 2);
    for (const width of [390, 320]) {
      await test.step(`${width}px`, async () => {
        await page.goto("about:blank");
        await gotoPhoneDashboard(page, { width, copper: true });
        await expect(page.locator("#totalsDots, #totalsPrev, #totalsNext")).toHaveCount(0);
        await expect(page.locator("#totalsLedger thead")).toBeHidden();
        await expect
          .poll(() => visibleLedgerRows(page))
          .toEqual(["silver", "gold", "platinum", "palladium", "copper"]);
        const blocks = await page.locator("#totalsLedger .totals-row").evaluateAll((rows) =>
          rows
            .filter((r) => r.getClientRects().length > 0)
            .map((r) => {
              const box = (sel) => r.querySelector(sel).getBoundingClientRect();
              const top = (sel) => box(sel).top;
              const shown = (sel) => r.querySelector(sel).getClientRects().length > 0;
              const title = box(".total-title");
              const onLineOne = (sel) => {
                const b = box(sel);
                const middle = b.top + b.height / 2;
                return middle > title.top && middle < title.bottom;
              };
              const label = (sel) =>
                getComputedStyle(r.querySelector(sel), "::before").content.includes(
                  sel.endsWith("melt") ? "Melt" : "Gain"
                );
              return {
                key: r.dataset.metalKey,
                lineOne: onLineOne(".totals-col-melt") && onLineOne(".totals-col-gain"),
                labelled: label(".totals-col-melt") && label(".totals-col-gain"),
                gainShown: shown(".totals-col-gain"),
                lineTwo: top(".totals-col-items") > top(".total-title") + 10,
                paidShown: shown(".totals-col-paid") && shown(".totals-col-weight"),
                avgHidden: !shown(".totals-col-avg") && !shown(".totals-col-retail"),
              };
            })
        );
        expect(blocks).toHaveLength(6);
        for (const b of blocks) {
          expect(b, b.key).toEqual({
            key: b.key,
            lineOne: true,
            labelled: true,
            gainShown: true,
            lineTwo: true,
            paidShown: true,
            avgHidden: true,
          });
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        ).toBeLessThanOrEqual(0);
      });
    }
  });

  test("at 200% text size no Dashboard value truncates and the page does not scroll sideways", async ({
    page,
  }) => {
    await gotoPhoneDashboard(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await expect.poll(() => readClippedText(page)).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ).toBeLessThanOrEqual(0);
  });

  test("every Dashboard control has a 44px hit area at 390px", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoPhoneDashboard(page);
    const result = await page.evaluate(() => {
      const root = document.getElementById("tabViewDashboard");
      const controls = [
        ...root.querySelectorAll("button, a[href], select, [role='button'], [tabindex='0']"),
      ].filter(
        (el) =>
          el.checkVisibility({ visibilityProperty: true }) &&
          el.closest("[aria-hidden='true']") === null
      );
      const misses = [];
      let tested = 0;
      for (const el of controls) {
        el.scrollIntoView({ block: "center", inline: "center" });
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) continue;
        tested++;
        const points = [-21, 0, 21].flatMap((dx) => [-21, 0, 21].map((dy) => [cx + dx, cy + dy]));
        const missed = points.filter(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return !hit || (hit !== el && !el.contains(hit));
        });
        if (missed.length) {
          misses.push(`${el.id || el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return { tested, misses };
    });
    expect(result.tested).toBeGreaterThanOrEqual(15);
    expect(result.misses).toEqual([]);
  });

  test("Dashboard text is at least 12px at 390px", async ({ page }) => {
    await gotoPhoneDashboard(page);
    const small = await page.evaluate(() => {
      const root = document.getElementById("tabViewDashboard");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const found = new Set();
      while (walker.nextNode()) {
        const el = walker.currentNode.parentElement;
        if (!walker.currentNode.textContent.trim() || el.getClientRects().length === 0) continue;
        if (el.closest("[aria-hidden='true']") || el.closest(".sr-only")) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 12) found.add(`${el.className}: ${size}px`);
      }
      return [...found];
    });
    expect(small).toEqual([]);
  });

  test("the spot long-press listener never blocks page scrolling", async ({ page }) => {
    await page.addInitScript(() => {
      window.__touchListeners = [];
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, fn, options) {
        // Chromium makes an unflagged touchstart on window, document or body passive.
        // Only the app's scripts count; Playwright adds its own listeners.
        const fromApp = /\/js\/[^/]+\.js/.test(new Error().stack);
        if (type === "touchstart" && fromApp && options?.passive === false) {
          window.__touchListeners.push(this === window ? "window" : this.id || this.nodeName);
        }
        return add.call(this, type, fn, options);
      };
    });
    await gotoPhoneDashboard(page);
    const blocking = await page.evaluate(() =>
      window.__touchListeners.filter((target) =>
        ["window", "#document", "BODY", "HTML"].includes(target)
      )
    );
    expect(blocking).toEqual([]);
  });
});

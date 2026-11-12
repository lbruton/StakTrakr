import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";
import { installStakTrakrNetworkMocks } from "../helpers/mocks/routes.js";
import { readPhoneFloors } from "../helpers/phone-floors.js";
import { SAMPLE_SETTINGS_DIFF, showSampleDiffReview } from "../helpers/diff-review.js";
import { readHorizontalOverflow } from "../helpers/horizontal-overflow.js";
import { readSegmentCorners, SEGMENT_THEMES } from "../helpers/segment-corners.js";

const SETTINGS_TABS = [
  "site",
  "system",
  "cloud",
  "about",
  "api",
  "changelog",
  "collections",
  "currency",
  "faq",
  "grouping",
  "images",
  "market",
  "storage",
];

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
  test("the Purchase Price Lot/Each toggle keeps the group's outer corners at 390 in every theme", async ({
    page,
  }) => {
    test.setTimeout(test.info().timeout * SEGMENT_THEMES.length);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedInventory(page);
    await gotoApp(page);
    await openEditModal(page);
    for (const theme of SEGMENT_THEMES) {
      await test.step(theme, async () => {
        await applyTheme(page, theme);
        const groups = await readSegmentCorners(page, "#purchasePriceModeToggle");
        expect(groups).toHaveLength(1);
        expect(groups[0].overflow).toBe("visible");
        expect(groups[0].first).toEqual([groups[0].radius - 1, groups[0].radius - 1]);
        expect(groups[0].last).toEqual([groups[0].radius - 1, groups[0].radius - 1]);
      });
    }
  });

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

/** Boots the Dashboard at 1440 with the seed inventory. */
async function gotoDesktopDashboard(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await injectSeedInventory(page);
  await page.goto("/index.html");
}

/** Scrolls to the page end until Back to top shows; the page grows as the Dashboard renders. */
async function revealBackToTop(page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return document.getElementById("backToTopBtn").classList.contains("visible");
      })
    )
    .toBe(true);
}

/** Sets the document root font size. An empty string restores the default. */
function setRootFontSize(page, size) {
  return page.evaluate((value) => {
    document.documentElement.style.fontSize = value;
  }, size);
}

/**
 * Reads the phone bottom nav: row overflow, tabs outside the viewport, taps that do not
 * reach their tab centre, and tab label sizes below 12px.
 */
function readBottomNavFit(page) {
  return page.evaluate(() => {
    const nav = document.getElementById("appBottomNav");
    const viewportWidth = document.documentElement.clientWidth;
    const tabs = [...nav.querySelectorAll(".bottom-nav-btn")].filter(
      (tab) => tab.getClientRects().length > 0
    );
    const label = (tab) => tab.textContent.trim();
    return {
      scrollWidth: nav.scrollWidth,
      clientWidth: nav.clientWidth,
      tabs: tabs.length,
      offscreen: tabs
        .filter((tab) => {
          const r = tab.getBoundingClientRect();
          return r.left < 0 || r.right > viewportWidth;
        })
        .map(label),
      blocked: tabs
        .filter((tab) => {
          const r = tab.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !hit || !tab.contains(hit);
        })
        .map(label),
      smallLabels: tabs.filter((tab) => parseFloat(getComputedStyle(tab).fontSize) < 12).map(label),
    };
  });
}

/**
 * Reads a fixed element (the first `selector` match containing `text`) against the
 * visible bottom-nav tabs and Back to top. Finishes the element's animations first.
 */
function readAgainstBottomNav(page, { selector, text = "" }) {
  return page.evaluate(
    ({ sel, txt }) => {
      const el = [...document.querySelectorAll(sel)].find((node) => node.textContent.includes(txt));
      if (!el) return null;
      el.getAnimations().forEach((animation) => animation.finish());
      const box = el.getBoundingClientRect();
      const overlaps = (r) =>
        box.left < r.right && r.left < box.right && box.top < r.bottom && r.top < box.bottom;
      const tabs = [...document.querySelectorAll("#appBottomNav .bottom-nav-btn")].filter(
        (tab) => tab.getClientRects().length > 0
      );
      const backToTop = document.getElementById("backToTopBtn");
      return {
        box: {
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          right: box.right,
          width: box.width,
          height: box.height,
        },
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        tabs: tabs.length,
        overlapping: tabs.filter((tab) => overlaps(tab.getBoundingClientRect())).length,
        blocked: tabs
          .filter((tab) => {
            const r = tab.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !hit || !tab.contains(hit);
          })
          .map((tab) => tab.textContent.trim()),
        overlapsBackToTop: el !== backToTop && overlaps(backToTop.getBoundingClientRect()),
      };
    },
    { sel: selector, txt: text }
  );
}

const THEMES = ["light", "dark", "slate", "sepia"];

/** Switches the app theme and waits until the page carries it. */
async function applyTheme(page, theme) {
  await page.evaluate((name) => window.setTheme(name), theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/**
 * Lists what is wrong with each visible bullion-bar mark on the Your stack card: the wrong
 * element, an empty reference, a colour off its metal token, or a face under 3:1 on the card.
 */
function readBarMarkFaults(page) {
  return page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const channels = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const luminance = (css) => {
      const [r, g, b] = channels(css).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const card = getComputedStyle(document.getElementById("totalsSectionEl")).backgroundColor;
    const marks = [
      ...document.querySelectorAll(
        ".totals-row:not(.totals-row-all) .totals-metal-mark, .stack-weight-row .totals-metal-mark"
      ),
    ].filter((m) => m.getClientRects().length > 0);
    const faults = marks.length >= 8 ? [] : [`only ${marks.length} marks`];
    for (const mark of marks) {
      const row = mark.closest(".totals-row, .stack-weight-row");
      const key = ["silver", "gold", "platinum", "palladium", "copper"].find((m) =>
        row.classList.contains(m)
      );
      if (mark.tagName !== "svg" || mark.getAttribute("aria-hidden") !== "true") {
        faults.push(`${key}: ${mark.tagName} is not a hidden svg`);
        continue;
      }
      if (!(mark.querySelector("use")?.getBBox().width > 0)) faults.push(`${key}: empty bar`);
      const token = getComputedStyle(document.documentElement).getPropertyValue(`--${key}`);
      const shown = getComputedStyle(mark).color;
      if (channels(shown).join() !== channels(token).join()) faults.push(`${key}: ${shown}`);
      // A probe inside the mark inherits its colour, as the symbol's cloned paths do.
      const fillOf = (setUp) => {
        const probe = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        setUp(probe);
        mark.append(probe);
        const fill = getComputedStyle(probe).fill;
        probe.remove();
        return fill;
      };
      for (const face of ["--metal-bar-top", "--metal-bar-front", "--metal-bar-side"]) {
        const fill = fillOf((probe) => probe.setAttribute("class", face.slice(2)));
        const expected = fillOf((probe) => (probe.style.fill = `var(${face})`));
        if (channels(fill).join() !== channels(expected).join()) {
          faults.push(`${key} ${face}: ${fill}, expected ${expected}`);
        }
        const ratio = contrast(fill, card);
        if (ratio < 3) faults.push(`${key} ${face}: ${ratio.toFixed(2)}`);
      }
    }
    return faults;
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
  test("Weight held shows a dash per metal and one note when no metal has a buy in 12 months", async ({
    page,
  }) => {
    // Every seed purchase is dated more than 12 months before the spot series ends.
    await gotoDesktopDashboard(page);
    const pace = page.locator("#stackWeights .stack-weight-pace");
    await expect(page.locator("#stackWeightsRate")).toBeVisible();
    await expect(pace).not.toHaveCount(0);
    await expect(pace).toHaveText(Array(await pace.count()).fill("—"));
    const note = page.locator("#stackWeightsNote");
    await expect(note).toBeVisible();
    await expect(note).toHaveText("No buys in the last 12 months.");
  });

  test("one table: a row per held metal in Metal Order, All Metals as the footer, aligned figures, one frame", async ({
    page,
  }) => {
    await gotoDesktopDashboard(page);
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
      "Gain/Loss",
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
    // The Realized figure sums the same gains, as a percentage of the cost that left.
    await expect(page.locator("#stackRealizedValue")).toHaveText("+$30.00");
    await expect(page.locator("#stackRealizedSub")).toHaveText("+50.0% on $60.00 cost");
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

  test("a click anywhere on a ledger row opens that row's breakdown once, at 1440 and 390", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    const cases = [
      [1440, "Silver", "#currentValueSilver"],
      [1440, "Gold", "#totalItemsGold"],
      [1440, "Silver", ".total-title[data-metal='Silver'] > button"],
      [1440, "All", "#lossProfitAll"],
      [390, "Gold", "#totalPurchasedGold"],
      [390, "All", "#lossProfitAll"],
    ];
    test.setTimeout(test.info().timeout * 2);
    for (const [width, metal, target] of cases) {
      await test.step(`${target} at ${width}`, async () => {
        if (page.viewportSize()?.width !== width) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto("/index.html");
        }
        // Each call to showDetailsModal rewrites the modal title once.
        await page.evaluate(() => {
          window.__titleWrites = 0;
          window.__titleObserver?.disconnect();
          window.__titleObserver = new MutationObserver((records) => {
            window.__titleWrites += records.length;
          });
          window.__titleObserver.observe(document.getElementById("detailsModalTitle"), {
            childList: true,
          });
        });
        await page.locator(target).click();
        await expect(page.locator("#detailsModal")).toBeVisible();
        await expect(page.locator("#detailsModalTitle")).toContainText(
          metal === "All" ? "All Metals" : metal
        );
        expect(await page.evaluate(() => window.__titleWrites)).toBe(1);
        await page.evaluate(() => closeDetailsModal());
        await expect(page.locator("#detailsModal")).toBeHidden();
      });
    }
  });

  test("each metal row shows a bullion bar in its metal colour at 3:1 on the card in every theme", async ({
    page,
  }) => {
    await gotoDesktopDashboard(page);
    await expect(page.locator("#stackWeights li")).toHaveCount(4);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of THEMES) {
        await test.step(`${theme} at ${width}`, async () => {
          await applyTheme(page, theme);
          await expect.poll(() => readBarMarkFaults(page)).toEqual([]);
        });
      }
    }
    await expect(page.locator(".totals-row-all .totals-metal-mark")).toBeHidden();
    // The symbol sheet takes no room above the card title.
    await expect(page.locator(".metal-bar-sprite")).toBeHidden();
  });

  test("ledger rows show a pointer and a hover surface in every theme", async ({ page }) => {
    await gotoDesktopDashboard(page);
    await expect(page.locator("#currentValueSilver")).toBeVisible();
    // The colour a cell shows: its own background, or the nearest opaque one behind it.
    const shownLightness = (selector) =>
      page.locator(selector).evaluate((cell) => {
        const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        let el = cell;
        let css = getComputedStyle(el).backgroundColor;
        while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(css)) {
          el = el.parentElement;
          css = el ? getComputedStyle(el).backgroundColor : "white";
        }
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      });
    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await applyTheme(page, theme);
        // Both reads come from one moment, so a colour transition cannot skew the gap.
        const gap = async (cell) =>
          Math.abs((await shownLightness(cell)) - (await shownLightness("#totalsSectionEl")));
        for (const cell of ["#currentValueSilver", "#lossProfitAll"]) {
          // At rest the row shows the section surface; only the hover sets it apart.
          await page.mouse.move(0, 0);
          await expect.poll(() => gap(cell), { message: `${cell} at rest` }).toBeLessThanOrEqual(1);
          await page.locator(cell).hover();
          await expect.poll(() => gap(cell), { message: cell }).toBeGreaterThanOrEqual(4);
          expect(await page.locator(cell).evaluate((c) => getComputedStyle(c).cursor)).toBe(
            "pointer"
          );
        }
        // Every cell of a row changes on one frame: the name cell has no fade of its own.
        await page.mouse.move(0, 0);
        await page.locator("#currentValueSilver").hover();
        const cells = await page.evaluate(() => {
          const read = (selector) => {
            const style = getComputedStyle(document.querySelector(selector));
            return { background: style.backgroundColor, fade: style.transitionDuration };
          };
          return [read(".totals-row.silver .total-title"), read("#currentValueSilver")];
        });
        expect(cells[0]).toEqual(cells[1]);
        expect(cells[0].fade).toBe("0s");
      });
    }
  });

  test("Your stack: the figures sit over the ledger and the card ends on the ledger, at 1440 and 390", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    for (const width of [1440, 390]) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/index.html");
        await expect(page.locator("#stackRetailValue")).not.toHaveText("$0.00");
        const card = await page.evaluate(() => {
          const box = (id) => document.getElementById(id).getBoundingClientRect();
          const ledgerBottom = box("totalsLedger").bottom;
          return {
            figuresAboveLedger: box("stackHeadlineFigures").bottom <= box("totalsLedger").top + 1,
            belowLedger: [...document.getElementById("totalsSectionEl").querySelectorAll("*")]
              .filter((el) => el.getClientRects().length > 0)
              .filter((el) => el.getBoundingClientRect().top >= ledgerBottom - 1)
              .map((el) => `${el.tagName}.${el.className}`),
          };
        });
        expect(card).toEqual({ figuresAboveLedger: true, belowLedger: [] });
      });
    }
  });

  test("Your stack figures: one row at 1440, the lead over two columns at 390, Realized hides", async ({
    page,
  }) => {
    await injectSeedInventory(page);
    // Each visible figure's box, in DOM order, relative to the figures block. The figures
    // align on their last line, so a row shares a bottom edge, not a top one.
    const readFigures = () =>
      page.evaluate(() => {
        const list = document.getElementById("stackHeadlineFigures");
        const outer = list.getBoundingClientRect();
        return [...list.children]
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              label: el.querySelector("dt").textContent.trim(),
              bottom: Math.round(r.bottom - outer.top),
              left: Math.round(r.left - outer.left),
              right: Math.round(outer.right - r.right),
              width: Math.round(r.width),
            };
          });
      });
    const labels = ["Retail value", "Melt value", "Loss on cost", "Cost basis", "Realized"];

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/index.html");
    await expect(page.locator("#stackRetailValue")).not.toHaveText("$0.00");
    const wide = await readFigures();
    expect(wide.map((f) => f.label)).toEqual(labels);
    expect(new Set(wide.map((f) => f.bottom)).size).toBe(1);
    expect(wide.map((f) => f.left)).toEqual([...wide.map((f) => f.left)].sort((a, b) => a - b));
    expect(new Set(wide.slice(1).map((f) => f.width)).size).toBe(1);
    expect(wide[0].width).toBeGreaterThan(wide[1].width);

    // With Realized off, the other figures widen to fill the row.
    await page.evaluate(() => applyRealizedVisibility(false));
    await expect(page.locator("#stackRealizedFigure")).toBeHidden();
    const narrow = await readFigures();
    expect(narrow.map((f) => f.label)).toEqual(labels.slice(0, 4));
    expect(narrow.at(-1).right).toBeLessThanOrEqual(1);
    expect(narrow[1].width).toBeGreaterThan(wide[1].width);
    await page.evaluate(() => applyRealizedVisibility(true));

    await page.setViewportSize({ width: 390, height: 900 });
    await expect.poll(async () => (await readFigures())[0].right).toBeLessThanOrEqual(1);
    const phone = await readFigures();
    expect(phone[0]).toMatchObject({ left: 0, right: 0 });
    // Melt and Gain share the second row, Cost basis and Realized the third.
    expect(phone[1].bottom).toBe(phone[2].bottom);
    expect(phone[3].bottom).toBe(phone[4].bottom);
    expect(phone[1].bottom).toBeGreaterThan(phone[0].bottom);
    expect(phone[3].bottom).toBeGreaterThan(phone[1].bottom);
    expect(phone[1].left).toBe(0);
    expect(phone[3].left).toBe(0);
  });
});

/**
 * Reads the background of each Dashboard frame, which of the header, ticker and footer cast a
 * shadow, the colour each ticker fade starts from, and whether a ratio chip is lighter than its card.
 */
function readDashboardFrames(page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const lightness = (css) => {
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const frames = {
      header: document.querySelector(".app-header"),
      spot: document.querySelector('.spot-card[data-metal="silver"]'),
      ticker: document.getElementById("bestPriceTickerEl"),
      stack: document.getElementById("totalsSectionEl"),
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
      chipLighter:
        lightness(getComputedStyle(document.querySelector(".spot-ratio-chip")).backgroundColor) >
        lightness(getComputedStyle(frames.spot).backgroundColor) + 1,
    };
  });
}

test.describe("Dashboard frames", () => {
  test("header, spot cards, ticker, Your stack and footer share one surface in every theme", async ({
    page,
  }) => {
    await gotoDesktopDashboard(page);
    await expect(page.locator("#bestPriceTickerEl .ticker-track")).toHaveCount(1);
    await expect(page.locator(".spot-ratio-chip").first()).toBeVisible();
    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await applyTheme(page, theme);
        await expect
          .poll(async () => {
            const { backgrounds, shadowed, fades, chipLighter } = await readDashboardFrames(page);
            return {
              colours: [...new Set(Object.values(backgrounds))].length,
              shadowed,
              fadesMatch: fades.every((f) => f === backgrounds.ticker),
              chipLighter,
            };
          })
          .toEqual({ colours: 1, shadowed: [], fadesMatch: true, chipLighter: true });
      });
    }
  });

  test("ticker chips stay out of the outer 8px at each edge in every theme at 1440 and 390", async ({
    page,
  }) => {
    await expectCleanTickerEdges(page, THEMES, "", readTickerEdgeInk);
  });

  test("the strip clips chips 8px inside its border, with or without the fades", async ({
    page,
  }) => {
    // Without the fades, only a clip keeps a chip out of the border band.
    await expectCleanTickerEdges(
      page,
      ["dark", "light"],
      ".market-ticker::before, .market-ticker::after { display: none !important; }",
      readTickerBorderInk
    );
  });
});

/**
 * Reads, for each tab panel, whether it matches the header surface and casts no shadow, and
 * whether the inner surface on it (table header cell or collection card) stands one step off it.
 * An inset shadow that covers the element, the inventory header's tint, paints over its fill.
 */
function readTabPanels(page) {
  return page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const lightness = (el) => {
      const style = getComputedStyle(el);
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const tint = style.boxShadow.match(/^(rgba?\([^)]*\)) 0px 0px 0px \d{4,}px inset$/);
      if (tint) {
        ctx.fillStyle = tint[1];
        ctx.fillRect(0, 0, 1, 1);
      }
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const header = getComputedStyle(document.querySelector(".app-header")).backgroundColor;
    const panels = {
      search: ["#searchSectionEl", null],
      table: ["#tableSectionEl", "#tableSectionEl thead th"],
      market: ["#vendorPricesSectionEl", ".vendor-prices-table thead th"],
      collections: ["#collectionsSectionEl", ".collections-card"],
    };
    return Object.fromEntries(
      Object.entries(panels).map(([key, [panelSel, innerSel]]) => {
        const panel = document.querySelector(panelSel);
        const inner = innerSel && document.querySelector(innerSel);
        return [
          key,
          {
            matchesHeader: getComputedStyle(panel).backgroundColor === header,
            shadow: getComputedStyle(panel).boxShadow,
            innerStandsOff: inner ? Math.abs(lightness(inner) - lightness(panel)) > 2 : null,
          },
        ];
      })
    );
  });
}

/**
 * Returns the lowest WCAG contrast of the text in each surface against that surface: any text
 * in a Market header cell, and the muted labels on a collection card.
 */
function readSurfaceContrast(page) {
  return page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const luminance = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const lowest = (surfaceSel, textSel) =>
      Math.min(
        ...[...document.querySelectorAll(surfaceSel)].flatMap((surface) =>
          [surface, ...surface.querySelectorAll(textSel)]
            .filter((el) =>
              [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
            )
            .map((el) =>
              ratio(getComputedStyle(el).color, getComputedStyle(surface).backgroundColor)
            )
        )
      );
    return {
      marketHeader: lowest(".vendor-prices-table thead th", "*"),
      collectionLabels: lowest(
        ".collections-card",
        ".collections-card-sub, .collections-card-foot"
      ),
      collectionCount: lowest(".collections-card", ".collections-count b"),
    };
  });
}

test.describe("Tab panel frames", () => {
  test("Inventory, Market and Collections panels share the frame surface in every theme", async ({
    page,
  }) => {
    await gotoDesktopDashboard(page);
    await page.locator("#tabBtnMarket").click();
    await expect(page.locator(".vendor-prices-table thead th").first()).toBeVisible();
    await page.locator("#tabBtnCollections").click();
    await page.waitForFunction(() => !!window.collectionsStore);
    await page.evaluate(() => {
      const made = window.collectionsStore.createCustom({
        name: "Frame surface fixture",
        metal: "Silver",
        slots: [{ label: "One", year: "2024", note: "" }],
      });
      if (!made.ok) throw new Error(`Fixture creation failed: ${made.reason}`);
    });
    await expect(page.locator(".collections-card").first()).toBeVisible();
    await expect(page.locator("#tableSectionEl thead th").first()).toBeAttached();
    const flat = { matchesHeader: true, shadow: "none" };
    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await applyTheme(page, theme);
        await expect
          .poll(() => readTabPanels(page))
          .toEqual({
            search: { ...flat, innerStandsOff: null },
            table: { ...flat, innerStandsOff: true },
            market: { ...flat, innerStandsOff: true },
            collections: { ...flat, innerStandsOff: true },
          });
        const contrast = await readSurfaceContrast(page);
        expect(contrast.marketHeader).toBeGreaterThanOrEqual(4.5);
        expect(contrast.collectionLabels).toBeGreaterThanOrEqual(4.5);
        expect(contrast.collectionCount).toBeGreaterThanOrEqual(4.5);
      });
    }
    // The global section rule lifts a hovered section; the panels stay flat. Each panel is
    // hovered on its own tab, since a hidden panel cannot take the pointer.
    const hovered = [
      ["inventory", "#searchSectionEl"],
      ["inventory", "#tableSectionEl"],
      ["market", "#vendorPricesSectionEl"],
      ["collections", "#collectionsSectionEl"],
    ];
    for (const [tab, selector] of hovered) {
      await test.step(`${selector} hovered`, async () => {
        await page.locator(`.app-tab-btn[data-tab="${tab}"]`).click();
        const panel = page.locator(selector);
        await panel.hover({ position: { x: 4, y: 4 } });
        await expect(panel).toHaveCSS("box-shadow", "none");
      });
    }
  });
});

/**
 * Boots the Dashboard at 1440 and 390 with the ticker track held still, then expects no ink in
 * either edge band and some ink in the centre band, in each theme.
 */
async function expectCleanTickerEdges(page, themes, extraCss, readInk) {
  await injectSeedInventory(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/index.html");
    await expect(page.locator("#bestPriceTickerEl .ticker-item .coin").first()).toBeVisible();
    // The boot toast sits bottom right and can cover the strip's right band when it is at the fold.
    await page.addStyleTag({
      content: `.ticker-track { animation: none !important; } .cloud-toast { display: none !important; } ${extraCss}`,
    });
    for (const theme of themes) {
      await test.step(`${theme} at ${width}`, async () => {
        await applyTheme(page, theme);
        const { left, right, centre } = await readInk(page);
        expect({ left, right }).toEqual({ left: 0, right: 0 });
        expect(centre).toBeGreaterThan(0);
      });
    }
  }
}

/** Reads the strip, its frame, both border widths and the first and last matches, track at rest. */
function readTickerGeometry(page, itemSelector) {
  return page.evaluate((selector) => {
    const ticker = document.getElementById("bestPriceTickerEl");
    ticker.querySelector(".ticker-track").style.transform = "none";
    const rect = (el) => {
      const { left, right, top, width, height } = el.getBoundingClientRect();
      return { left, right, top, width, height };
    };
    const border = (el) => parseFloat(getComputedStyle(el).borderLeftWidth);
    const items = [...ticker.querySelectorAll(selector)];
    return {
      box: rect(ticker),
      outer: rect(ticker.parentElement),
      stripBorder: border(ticker),
      frameBorder: border(ticker.parentElement),
      first: rect(items[0]),
      last: rect(items[items.length - 1]),
    };
  }, itemSelector);
}

/** Moves the held track and waits two frames, so a screenshot shows the new position. */
function shiftTickerTrack(page, shift, visibility = "visible") {
  return page.evaluate(
    ([px, shown]) => {
      const track = document.querySelector("#bestPriceTickerEl .ticker-track");
      track.style.transform = `translateX(${px}px)`;
      track.style.visibility = shown;
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    [shift, visibility]
  );
}

/** Screenshots a clip and returns its pixels as a flat RGB array. */
async function readClipPixels(page, clip) {
  const png = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(0, 0, img.width, img.height).data].filter((_, i) => i % 4 !== 3);
  }, png);
}

/** Counts the pixels that differ by more than 3 in any channel from referenceAt(index). */
function countInk(pixels, referenceAt) {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 3) {
    const ref = referenceAt(i);
    if ([0, 1, 2].some((c) => Math.abs(pixels[i + c] - ref[c]) > 3)) count += 1;
  }
  return count;
}

/**
 * Holds a chip across each strip edge and counts the pixels that change when the track shows.
 * Each band covers the border and the next 8px over the full strip height. The centre band is
 * the control: a chip held there must change pixels.
 */
async function readTickerBorderInk(page) {
  await page.locator("#bestPriceTickerEl").scrollIntoViewIfNeeded();
  const { box, outer, stripBorder, frameBorder, first, last } = await readTickerGeometry(
    page,
    ".ticker-item"
  );
  // The frame draws the border when the strip does not, so the band starts at the outer edge.
  expect(Math.max(stripBorder, frameBorder)).toBeGreaterThan(0);
  const band = Math.floor(Math.max(stripBorder, frameBorder) + 8);
  const middle = (box.left + box.right) / 2;
  const edges = {
    left: [box.left - first.width / 2 - first.left, Math.floor(Math.min(outer.left, box.left))],
    right: [
      box.right + last.width / 2 - last.right,
      Math.ceil(Math.max(outer.right, box.right)) - band,
    ],
    centre: [middle - (first.left + first.right) / 2, Math.round(middle) - band / 2],
  };
  const ink = {};
  for (const [edge, [shift, x]] of Object.entries(edges)) {
    const clip = { x, y: Math.ceil(box.top), width: band, height: Math.floor(box.height) };
    await shiftTickerTrack(page, shift);
    const shown = await readClipPixels(page, clip);
    await shiftTickerTrack(page, shift, "hidden");
    const hidden = await readClipPixels(page, clip);
    await shiftTickerTrack(page, shift);
    ink[edge] = countInk(shown, (i) => hidden.slice(i, i + 3));
  }
  return ink;
}

/**
 * Holds the ticker track so a chip's coin name crosses each inner edge, then counts the pixels in
 * the outer 8px band (over the coin text's height) that differ from the strip background. The
 * centre band over a coin name centred in the strip is the control: it must show ink.
 */
async function readTickerEdgeInk(page) {
  // The ticker follows Your stack and can sit below the fold; a screenshot clip must be on screen.
  await page.locator("#bestPriceTickerEl").scrollIntoViewIfNeeded();
  const bandWidth = 8;
  const { box, stripBorder, first, last } = await readTickerGeometry(page, ".ticker-item .coin");
  const innerLeft = box.left + stripBorder;
  const innerRight = box.right - stripBorder;
  const middle = (innerLeft + innerRight) / 2;
  const edges = {
    left: [innerLeft - 10 - first.left, Math.ceil(innerLeft)],
    right: [innerRight + 10 - last.right, Math.floor(innerRight) - bandWidth],
    centre: [middle - (first.left + first.right) / 2, Math.round(middle) - bandWidth / 2],
  };
  const bg = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = getComputedStyle(document.getElementById("bestPriceTickerEl")).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  const ink = {};
  for (const [edge, [shift, x]] of Object.entries(edges)) {
    const clip = { x, y: Math.ceil(first.top), width: bandWidth, height: Math.floor(first.height) };
    await shiftTickerTrack(page, shift);
    ink[edge] = countInk(await readClipPixels(page, clip), () => bg);
  }
  return ink;
}

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
    const cases = [390, 320].flatMap((width) => THEMES.map((theme) => ({ width, theme })));
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
        // The row shows the value that leads, so the gain reads against the figure beside it.
        for (const [lead, other, name] of [
          ["retail", "melt", "Retail"],
          ["melt", "retail", "Melt"],
        ]) {
          await expect(page.locator("#totalsLedger")).toHaveAttribute("data-lead", lead);
          const blocks = await page.locator("#totalsLedger .totals-row").evaluateAll(
            (rows, { value, hidden, valueName }) =>
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
                  const label = (sel, text) =>
                    getComputedStyle(r.querySelector(sel), "::before").content.includes(text);
                  return {
                    key: r.dataset.metalKey,
                    lineOne: onLineOne(value) && onLineOne(".totals-col-gain"),
                    labelled: label(value, valueName) && label(".totals-col-gain", "Gain/Loss"),
                    gainShown: shown(".totals-col-gain"),
                    lineTwo: top(".totals-col-items") > top(".total-title") + 10,
                    paidShown: shown(".totals-col-paid") && shown(".totals-col-weight"),
                    avgHidden: !shown(".totals-col-avg") && !shown(hidden),
                  };
                }),
            {
              value: `.totals-col-${lead}`,
              hidden: `.totals-col-${other}`,
              valueName: name,
            }
          );
          expect(blocks).toHaveLength(6);
          for (const b of blocks) {
            expect(b, `${lead} ${b.key}`).toEqual({
              key: b.key,
              lineOne: true,
              labelled: true,
              gainShown: true,
              lineTwo: true,
              paidShown: true,
              avgHidden: true,
            });
          }
          await page.locator("#stackLeadSwap").click();
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

  test("Back to top floats clear of the bottom nav on phones and keeps its corner at 1440", async ({
    page,
  }) => {
    for (const [width, height] of [
      [390, 844],
      [768, 1024],
    ]) {
      await test.step(`${width}x${height}`, async () => {
        await page.goto("about:blank");
        await gotoPhoneDashboard(page, { width });
        await page.setViewportSize({ width, height });
        await revealBackToTop(page);
        const read = async () => {
          const r = await readAgainstBottomNav(page, { selector: "#backToTopBtn" });
          return {
            tabs: r.tabs,
            overlapping: r.overlapping,
            blocked: r.blocked,
            size: Math.min(r.box.width, r.box.height) >= 44,
            onScreen: r.box.top >= 0 && r.box.bottom <= r.viewport.height,
          };
        };
        // Larger roots grow the nav. Every tab must stay tappable at each size.
        for (const rootSize of ["", "20px", "24px", "32px"]) {
          await setRootFontSize(page, rootSize);
          await revealBackToTop(page);
          await expect.poll(read, { message: `root font ${rootSize || "default"}` }).toEqual({
            tabs: expect.any(Number),
            overlapping: 0,
            blocked: [],
            size: true,
            onScreen: true,
          });
          expect((await read()).tabs).toBeGreaterThanOrEqual(4);
        }
      });
    }

    await test.step("1440x900", async () => {
      await page.goto("about:blank");
      // The seeded Dashboard at 900px tall scrolls less than the 300px reveal threshold.
      await gotoDesktopDashboard(page);
      expect(
        await page.locator("#backToTopBtn").evaluate((el) => {
          const s = getComputedStyle(el);
          return [s.bottom, s.right, s.width, s.height];
        })
      ).toEqual(["32px", "32px", "40px", "40px"]);
    });
  });

  test("the phone bottom nav fits 390px and every tab stays tappable at 16, 20, 24 and 32px roots", async ({
    page,
  }) => {
    await gotoPhoneDashboard(page);
    for (const rootSize of ["", "20px", "24px", "32px"]) {
      await test.step(`root font ${rootSize || "default"}`, async () => {
        await setRootFontSize(page, rootSize);
        await expect
          .poll(() => readBottomNavFit(page), { message: "bottom nav fit" })
          .toEqual(
            expect.objectContaining({
              offscreen: [],
              blocked: [],
              smallLabels: [],
            })
          );
        const fit = await readBottomNavFit(page);
        expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
        expect(fit.tabs).toBe(5);
      });
    }
  });

  test("toasts sit above the bottom nav and Back to top on phones and keep their corner at 1440", async ({
    page,
  }) => {
    const toasts = [
      {
        name: "message toast",
        target: { selector: ".cloud-toast", text: "Phone toast check" },
        show: () => window.showToast("Phone toast check", 5000),
      },
      {
        name: "What's New card",
        target: { selector: ".whats-new-toast-card", text: "What’s New" },
        show: () => window.showWhatsNewPopup(),
      },
    ];
    const removeToasts = () =>
      page.evaluate(() =>
        document
          .querySelectorAll(".cloud-toast, .whats-new-toast-card")
          .forEach((el) => el.remove())
      );

    for (const [width, height] of [
      [390, 844],
      [768, 1024],
    ]) {
      await test.step(`${width}x${height}`, async () => {
        await page.goto("about:blank");
        await gotoPhoneDashboard(page, { width });
        await page.setViewportSize({ width, height });
        await revealBackToTop(page);
        for (const toast of toasts) {
          await removeToasts();
          await page.evaluate(toast.show);
          const read = async () => {
            const r = await readAgainstBottomNav(page, toast.target);
            if (!r) return null;
            return {
              overlapping: r.overlapping,
              blocked: r.blocked,
              overlapsBackToTop: r.overlapsBackToTop,
              inGutters:
                Math.round(r.box.left) >= 16 &&
                Math.round(r.viewport.width - r.box.right) >= 16 &&
                r.box.top >= 0,
            };
          };
          await expect.poll(read, { message: toast.name }).toEqual({
            overlapping: 0,
            blocked: [],
            overlapsBackToTop: false,
            inGutters: true,
          });
        }
        await removeToasts();
      });
    }

    await test.step("1440x900", async () => {
      await page.goto("about:blank");
      await gotoDesktopDashboard(page);
      for (const toast of toasts) {
        await removeToasts();
        await page.evaluate(toast.show);
        const corner = page.locator(toast.target.selector, { hasText: toast.target.text });
        expect(
          await corner.evaluate((el) => {
            const s = getComputedStyle(el);
            return [s.bottom, s.right];
          }),
          toast.name
        ).toEqual(["24px", "24px"]);
      }
    });
  });

  test("Dashboard and bottom-nav text is at least 12px at 390px", async ({ page }) => {
    await gotoPhoneDashboard(page);
    const small = await page.evaluate(() => {
      const found = new Set();
      for (const id of ["tabViewDashboard", "appBottomNav"]) {
        const walker = document.createTreeWalker(document.getElementById(id), NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const el = walker.currentNode.parentElement;
          if (!walker.currentNode.textContent.trim() || el.getClientRects().length === 0) continue;
          if (el.closest("[aria-hidden='true']") || el.closest(".sr-only")) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 12) found.add(`${el.className}: ${size}px`);
        }
      }
      return [...found];
    });
    expect(small).toEqual([]);

    // Each label wraps to at most two lines inside its button, with no clipping, down to 320px.
    const cases = [390, 320].flatMap((width) => THEMES.map((theme) => [width, theme]));
    for (const [width, theme] of cases) {
      await test.step(`bottom-nav labels at ${width}px in ${theme}`, async () => {
        await page.setViewportSize({ width, height: 844 });
        await applyTheme(page, theme);
        const faults = await page.evaluate(() =>
          [...document.querySelectorAll("#appBottomNav .bottom-nav-btn:not([hidden])")]
            .map((btn) => {
              const text = [...btn.childNodes].find(
                (n) => n.nodeType === 3 && n.textContent.trim()
              );
              const range = document.createRange();
              range.selectNodeContents(text);
              const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
              return lines.size <= 2 && btn.scrollWidth <= btn.clientWidth
                ? null
                : `${text.textContent.trim()}: ${lines.size} lines`;
            })
            .filter(Boolean)
        );
        expect(faults).toEqual([]);
      });
    }
  });

  test("spot card timestamps are at least 12px and whole at desktop and phone widths", async ({
    page,
  }) => {
    await gotoDesktopDashboard(page);
    await expect(page.locator(".spot-card-timestamp").first()).toBeVisible();
    // A latest spot entry of each source: the sync label, a manual price and a seed price
    // dated after the last sync, each written by updateSpotTimestamp.
    const setSource = (source, label) =>
      page.evaluate(
        ([src, text]) => {
          const names = ["Silver", "Gold", "Platinum", "Palladium", "Copper"];
          const timestamp = src === "seed" ? "2099-01-01T12:00:00Z" : new Date().toISOString();
          if (src)
            names.forEach((metal) => spotHistory.push({ metal, spot: 1, source: src, timestamp }));
          names.forEach((metal) => updateSpotTimestamp(metal));
          return document.querySelector(".spot-card-timestamp").textContent.includes(text);
        },
        [source, label]
      );
    const cases = [
      [null, "Synced"],
      ["manual", "Manual"],
      ["seed", "Seed"],
    ].flatMap((state) => [1440, 1280, 1024, 390, 320].map((width) => [...state, width]));
    for (const [source, label, width] of cases) {
      await test.step(`${label} at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 900 });
        expect(await setSource(source, label)).toBe(true);
        const read = () =>
          page.locator(".spot-card-timestamp").evaluateAll((els) =>
            els
              .filter((el) => el.getClientRects().length)
              .map((el) => ({
                small: parseFloat(getComputedStyle(el).fontSize) < 12,
                cut: el.scrollWidth > el.clientWidth,
              }))
          );
        const cards = await read();
        expect(cards.length).toBeGreaterThan(0);
        await expect.poll(read).toEqual(cards.map(() => ({ small: false, cut: false })));
      });
    }
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

test.describe("Phone floors in Collections, Item modals and Settings", () => {
  /** Links the seeded silver coin to the 2024 Slot of the American Silver Eagle Collection. */
  const linkBaseItem = (page) =>
    page.evaluate(
      (uuid) => window.collectionsStore.link("ase-type2", "2024", uuid),
      BASE_ITEM.uuid
    );

  const surfaces = [
    [
      "Collections hub",
      "#collectionsSectionEl",
      (page) => page.evaluate(() => window.activateTab("collections")),
    ],
    ["Edit Item modal", "#itemModal .modal-content", (page) => openEditModal(page)],
    ["Item view modal", "#viewItemModal .modal-content", (page) => openViewModal(page)],
    [
      "Collection album with a linked Slot",
      "#collectionsSectionEl",
      async (page) => {
        await linkBaseItem(page);
        await page.evaluate(() => {
          window.activateTab("collections");
          window.collectionsUI.openCollection("ase-type2");
        });
      },
    ],
    [
      "Item view modal of a Collection member",
      "#viewItemModal .modal-content",
      async (page) => {
        await linkBaseItem(page);
        await openViewModal(page);
      },
    ],
    [
      "Settings cloud panel with the Dropbox sign-out link and a backup list",
      "#settingsModal .modal-content",
      async (page) => {
        await page.evaluate(() => {
          window.showSettingsModal("cloud");
          renderCloudBackupList(
            "dropbox",
            [0, 1, 2].map((i) => ({
              name: `${window.SYNC_BACKUP_PREFIX}${i}.stvault`,
              server_modified: new Date(2026, 10, 1 + i, 9, 5).toISOString(),
              size: 48_000,
            }))
          );
        });
        await page.locator("#cloudDropboxSignoutLink").evaluate((el) => {
          el.style.display = "block";
        });
        await expect(page.locator("#cloudBackupList_dropbox .cloud-backup-entry")).toHaveCount(3);
      },
    ],
    [
      "Metal details modal",
      "#detailsModal .modal-content",
      (page) => page.evaluate(() => window.showDetailsModal("Silver")),
    ],
    ...[
      ["Diff review modal with Item and setting changes", ""],
      ["Diff review modal at a 14px root font size", "14px"],
    ].map(([label, rootFontSize]) => [
      label,
      "#diffReviewModal .modal-content",
      async (page) => {
        if (rootFontSize) {
          await page.evaluate((size) => {
            document.documentElement.style.fontSize = size;
          }, rootFontSize);
        }
        await showSampleDiffReview(page, {
          backupCount: 3,
          localCount: 2,
          settingsDiff: SAMPLE_SETTINGS_DIFF,
        });
        // The settings section opens collapsed; expanded, its chips and pills are measured too.
        await page.locator('#diffReviewModal [data-cat-toggle="settings"]').click();
        for (const control of [".dm-chip-enabled", ".dm-kv-pill.local", ".dm-count-btn"]) {
          await expect(page.locator(`#diffReviewModal ${control}`).first()).toBeVisible();
        }
      },
      // Setting choices carry a control role; the selector keeps the check on any that lose it.
      "[data-field][data-side], [data-setting-resolution]",
    ]),
    ...SETTINGS_TABS.map((tab) => [
      `Settings ${tab} panel`,
      "#settingsModal .modal-content",
      (page) => page.evaluate((t) => window.showSettingsModal(t), tab),
    ]),
  ];

  test("text is 12px, inputs 16px and every control has its own 44px hit area at 390px", async ({
    page,
  }) => {
    test.setTimeout(test.info().timeout * surfaces.length);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedInventory(page, BULK_ITEMS);
    for (const [label, root, open, extraControls] of surfaces) {
      await test.step(label, async () => {
        await page.goto("about:blank");
        await gotoApp(page);
        await open(page);
        await expect(page.locator(root)).toBeVisible();
        const floors = await readPhoneFloors(page, root, extraControls);
        expect(floors.tested).toBeGreaterThan(0);
        expect
          .soft({
            smallText: floors.smallText,
            smallInputs: floors.smallInputs,
            smallTargets: floors.smallTargets,
          })
          .toEqual({ smallText: [], smallInputs: [], smallTargets: [] });
      });
    }
  });

  const LONG_NAME = " 1 oz Brilliant Uncirculated with Original Mint Packaging and Certificate";
  const SCROLL_WRAPPERS = [
    ".settings-table-scroll",
    ".settings-changelog-wrap",
    ".market-filter-matrix-wrap",
  ];
  const overflowSurfaces = [
    ...SETTINGS_TABS.map((tab) => [
      `Settings ${tab} panel`,
      "#settingsModal .modal-content",
      [".modal-content", ".settings-content-area"],
      async (page) => {
        await page.evaluate((t) => window.showSettingsModal(t), tab);
        // Storage renders its tables after an async usage read; measure the tables, not the placeholders.
        if (tab === "storage") {
          await expect(page.locator("#settingsModal .storage-data-table")).toHaveCount(2);
        }
      },
    ]),
    [
      "Privacy policy modal",
      "#privacyModal .modal-content",
      [".modal-content", ".modal-body"],
      (page) => page.evaluate(() => window.openModalById("privacyModal")),
    ],
    [
      "Diff review modal with long Item names",
      "#diffReviewModal .modal-content",
      [".modal-content", ".modal-body"],
      (page) => showSampleDiffReview(page, {}, LONG_NAME),
    ],
  ];

  test("no Settings panel or sub-modal overflows sideways at 390px and 1440px", async ({
    page,
  }) => {
    const viewports = [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ];
    test.setTimeout(test.info().timeout * overflowSurfaces.length * viewports.length);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedInventory(page, BULK_ITEMS);
    await page.addInitScript((longName) => {
      const now = Date.parse("2026-11-01T12:00:00Z");
      const changeLog = Array.from({ length: 3 }, (_, i) => ({
        timestamp: now - i * 3600000,
        itemName: `Core Mobile Layout Eagle${longName}`,
        field: "purchaseLocation",
        oldValue: `https://www.example-dealer.com/products/silver/${"x".repeat(40)}`,
        newValue: `Local coin shop on Main Street${longName}`,
        idx: 0,
        undone: false,
      }));
      localStorage.setItem("changeLog", JSON.stringify(changeLog));
      const prices = {};
      for (const weight of [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100]) {
        prices[String(weight)] = { price: 5.12 * weight, source: "api", updatedAt: now };
      }
      localStorage.setItem("goldback-prices", JSON.stringify(prices));
      localStorage.setItem("goldback-pricing-source", JSON.stringify("api"));
      localStorage.setItem("goldback-enabled", "true");
    }, LONG_NAME);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const [label, root, bodies, open] of overflowSurfaces) {
        await test.step(`${label} at ${viewport.width}px`, async () => {
          await page.goto("about:blank");
          await gotoApp(page);
          await open(page);
          await expect(page.locator(root)).toBeVisible();
          await expect.soft(page.locator("#settingsModal .stk-nav-separator")).toHaveCount(0);
          const overflow = await readHorizontalOverflow(page, root, bodies, SCROLL_WRAPPERS);
          expect(overflow.tested).toBeGreaterThan(0);
          const { tested, ...found } = overflow;
          expect.soft(found).toEqual({
            scrollingBodies: [],
            pastEdge: [],
            clipped: [],
            ellipsis: [],
            narrowSelects: [],
          });
          for (const icon of await page.locator(`${root} .settings-info-icon`).all()) {
            if (!(await icon.isVisible())) continue;
            await icon.focus();
            const shown = await readHorizontalOverflow(page, root, bodies, SCROLL_WRAPPERS);
            expect
              .soft(shown.scrollingBodies, `shown tip: ${await icon.getAttribute("aria-label")}`)
              .toEqual([]);
          }
        });
      }
    }
  });

  test("the Privacy policy scrolls as one surface that fills the phone screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoApp(page);
    await page.evaluate(() => window.openModalById("privacyModal"));
    const content = page.locator("#privacyModal .modal-content");
    await expect(content).toBeVisible();
    const layout = await content.evaluate((el) => {
      const body = el.querySelector(".modal-body");
      return {
        bodyScrolls: body.scrollHeight > body.clientHeight + 1,
        contentScrolls: el.scrollHeight > el.clientHeight + 1,
        gapBelowBody: Math.round(
          el.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom
        ),
        sheetBottom: Math.round(el.getBoundingClientRect().bottom),
      };
    });
    // The shell pins its header, so the body is the one scroll surface.
    expect(layout.bodyScrolls).toBe(true);
    expect(layout.contentScrolls).toBe(false);
    expect(layout.gapBelowBody).toBeLessThanOrEqual(48);
    expect(layout.sheetBottom).toBe(844);
  });
});

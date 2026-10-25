// Colours that JS used to pick come from per-theme tokens and meet WCAG AA.
//
// STRK-450 covers the Numista bulk sync table status cells (Synced / Needs sync / Failed),
// the sync activity log lines (success / warn / error) and the spot lookup flash on a price
// input. STRK-452 covers the metal-tinted Item View header. Each is measured in all four
// themes, switched in place. The measure composites a translucent background over the
// nearest opaque ancestor before taking the ratio.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { suppressWhatsNewPopup } from "../helpers/seed.js";

const THEMES = ["light", "dark", "slate", "sepia"];
const AA_NORMAL_TEXT = 4.5;

async function gotoApp(page) {
  await suppressWhatsNewPopup(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.renderNumistaSyncUI === "function" &&
      typeof window.setTheme === "function" &&
      typeof flashSpotLookupTarget === "function"
  );
}

/**
 * Returns { color, ratio } for each selector match: the computed text colour and its WCAG
 * 2.x contrast over the element's background composited onto the nearest opaque ancestor.
 */
function measureText(page, selector) {
  return page.evaluate((sel) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const toRgba = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const over = (top, base) => {
      const a = top[3] / 255;
      return [0, 1, 2].map((i) => a * top[i] + (1 - a) * base[i]);
    };
    const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const luminance = ([r, g, b]) =>
      0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
    const opaqueBehind = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const c = toRgba(getComputedStyle(node).backgroundColor);
        if (c[3] === 255) return c;
      }
      return [255, 255, 255, 255];
    };
    return Array.from(document.querySelectorAll(sel)).map((el) => {
      const cs = getComputedStyle(el);
      const back = over(toRgba(cs.backgroundColor), opaqueBehind(el));
      const fore = over(toRgba(cs.color), back);
      const [hi, lo] = [luminance(back), luminance(fore)].sort((a, b) => b - a);
      return {
        text: el.textContent.trim(),
        color: cs.color,
        background: `rgb(${back.map(Math.round).join(", ")})`,
        inlineColor: el.style.color,
        ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
      };
    });
  }, selector);
}

/** Asserts each record meets AA and that the records use pairwise-distinct colours. */
function expectDistinctAa(records, theme, what) {
  for (const r of records) {
    expect(r.ratio, `${theme} ${what} "${r.text}" contrast ${r.ratio}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT
    );
    expect(r.inlineColor, `${theme} ${what} "${r.text}" sets no inline colour`).toBe("");
  }
  const colours = new Set(records.map((r) => r.color));
  expect(colours.size, `${theme} ${what} colours are distinct: ${[...colours]}`).toBe(
    records.length
  );
}

/** Stubs the image cache and bulk sync so the sync table renders three known rows. */
async function renderSyncTableWithFailure(page) {
  await page.evaluate(async () => {
    const rows = [
      { catalogId: "N-SYNCED", item: { name: "Synced coin" } },
      { catalogId: "N-NEEDS", item: { name: "Unsynced coin" } },
      { catalogId: "N-FAILED", item: { name: "Failed coin" } },
    ];
    imageCache.isAvailable = () => true;
    imageCache.getMetadata = async (id) => (id === "N-SYNCED" ? { id } : null);
    BulkImageCache.buildEligibleList = () => rows;
    BulkImageCache.isRunning = () => false;
    BulkImageCache.cacheAll = ({ onLog }) =>
      onLog({ catalogId: "N-FAILED", status: "meta-failed", message: "lookup failed" });
    window.appConfirm = async () => true;
    await window.renderNumistaSyncUI();
    await window.startBulkSync();
  });
  await expect(page.locator("#numistaSyncTableContainer tbody tr")).toHaveCount(3);
}

/** Opens the bulk sync activity log and logs one line per type. */
async function writeLogLines(page) {
  await page.evaluate(() => {
    document.getElementById("numistaSyncLogDetails").open = true;
    logSyncActivity("Metadata synced", "success");
    logSyncActivity("Metadata lookup failed", "warn");
    logSyncActivity("Catalog API not available", "error");
  });
  await expect(page.locator("#numistaSyncLog .cache-log-line")).toHaveCount(3);
}

test.describe("STRK-450 status colours from theme tokens", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("sync table status cells meet AA and differ by status in all four themes", async ({
    page,
  }) => {
    await renderSyncTableWithFailure(page);
    const statusCells = "#numistaSyncTableContainer tbody td:nth-child(3)";
    await expect(page.locator(statusCells)).toHaveText([/Synced/, /Needs sync/, /Failed/]);
    for (const theme of THEMES) {
      await page.evaluate((name) => window.setTheme(name), theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expectDistinctAa(await measureText(page, statusCells), theme, "status");
    }
  });

  test("sync log lines meet AA and differ by type in all four themes", async ({ page }) => {
    await writeLogLines(page);
    for (const theme of THEMES) {
      await page.evaluate((name) => window.setTheme(name), theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expectDistinctAa(await measureText(page, "#numistaSyncLog .cache-log-line"), theme, "log");
    }
  });

  test("spot lookup flash is visible, keeps the input text AA, and clears", async ({ page }) => {
    await page.addStyleTag({ content: "#itemPrice { transition: none !important; }" });
    for (const theme of THEMES) {
      await page.evaluate((name) => window.setTheme(name), theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const [rest] = await measureText(page, "#itemPrice");
      await page.evaluate(() => flashSpotLookupTarget(document.getElementById("itemPrice")));
      const [flash] = await measureText(page, "#itemPrice");
      expect(flash.background, `${theme} flash changes the input background`).not.toBe(
        rest.background
      );
      expect(flash.ratio, `${theme} input text over flash ${flash.ratio}:1`).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT
      );
      expect(
        await page.locator("#itemPrice").evaluate((el) => el.style.backgroundColor),
        `${theme} flash sets no inline background`
      ).toBe("");
      await expect
        .poll(async () => (await measureText(page, "#itemPrice"))[0].background, {
          message: `${theme} flash clears`,
        })
        .toBe(rest.background);
    }
  });
});

const METALS = ["Silver", "Gold", "Platinum", "Palladium", "Copper"];

/** Seeds one Item per metal and boots the inventory page. */
async function gotoAppWithMetalItems(page) {
  const items = METALS.map((metal, i) => ({
    uuid: `strk452-${metal.toLowerCase()}`,
    serial: i + 1,
    name: `${metal} Round`,
    metal,
    composition: metal,
    type: "Round",
    qty: 1,
    weight: 1,
    weightUnit: "oz",
    purity: 0.999,
    price: 30,
    date: "2026-04-01",
  }));
  await page.addInitScript((inv) => {
    localStorage.setItem("metalInventory", JSON.stringify(inv));
  }, items);
  await suppressWhatsNewPopup(page);
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.appListenersReady === true);
}

/**
 * Measures the open Item View header: the WCAG ratio of the title and the close (X) over each stop of the header
 * gradient (the extremes of a two-stop gradient bound every pixel between them), plus any
 * inline background JS left on the header or the image section.
 */
function measureViewHeader(page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const toRgb = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
    };
    const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const luminance = ([r, g, b]) =>
      0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
    const ratio = (a, b) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    const header = document.querySelector("#viewItemModal .modal-header");
    const title = document.getElementById("viewModalTitle");
    const image = document.getElementById("viewImageSection");
    const gradient = getComputedStyle(header).backgroundImage;
    const stops = gradient.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)/g) || [];
    const close = document.getElementById("viewModalCloseX");
    const fores = [title, close].map((el) => toRgb(getComputedStyle(el).color));
    return {
      gradient,
      stops: stops.map((s) => toRgb(s).join(",")),
      ratios: stops.flatMap((s) => fores.map((fore) => ratio(toRgb(s), fore))),
      inline: [header.style.background, image?.style.background ?? ""].filter(Boolean).join(" | "),
    };
  });
}

/**
 * Opens the Item View for each metal and switches through all four themes with the modal
 * open: the header must be a two-stop metal gradient whose title meets AA at both ends.
 */
async function expectAaViewHeadersInEveryTheme(page, { inlineTitleColour }) {
  for (const [index, metal] of METALS.entries()) {
    await page.evaluate((i) => window.showViewModal(i), index);
    await expect(page.locator("#viewModalTitle")).toHaveText(`${metal} Round`);
    for (const theme of THEMES) {
      await page.evaluate((name) => window.setTheme(name), theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const what = `${theme} ${metal} header`;
      await expect
        .poll(async () => Math.min(...(await measureViewHeader(page)).ratios), {
          message: `${what} title and close (X) meet AA at every gradient stop`,
        })
        .toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      const header = await measureViewHeader(page);
      expect(header.stops.length, `${what} gradient: ${header.gradient}`).toBe(2);
      expect(header.stops[0], `${what} gradient darkens toward the end`).not.toBe(header.stops[1]);
      expect(header.inline, `${what} sets no inline header or image background`).toBe("");
      const titleInline = await page.locator("#viewModalTitle").evaluate((el) => el.style.color);
      expect(titleInline !== "", `${what} inline title colour`).toBe(inlineTitleColour);
    }
    await page.evaluate(() => window.closeViewModal());
  }
}

test.describe("STRK-452 metal-tinted Item View header", () => {
  test("the header title meets AA for every metal in all four themes, switched in place", async ({
    page,
  }) => {
    test.setTimeout(test.info().timeout * 2);
    await gotoAppWithMetalItems(page);
    await expectAaViewHeadersInEveryTheme(page, { inlineTitleColour: false });
  });

  test("the JS fallback (no CSS contrast-color) also meets AA and re-picks on theme switch", async ({
    page,
  }) => {
    test.setTimeout(test.info().timeout * 2);
    await page.addInitScript(() => {
      const native = CSS.supports.bind(CSS);
      CSS.supports = (...args) =>
        String(args.join(" ")).includes("contrast-color") ? false : native(...args);
    });
    await gotoAppWithMetalItems(page);
    await expectAaViewHeadersInEveryTheme(page, { inlineTitleColour: true });
  });
});

test.describe("theme colours with reduced motion", () => {
  test("a theme switch reads the new token colours at once when reduced motion is on", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoApp(page);
    const reads = await page.evaluate(async (themes) => {
      const probe = document.createElement("span");
      probe.textContent = "probe";
      probe.style.cssText = "color: var(--text-primary); background: var(--bg-primary);";
      document.body.appendChild(probe);
      const read = () => {
        const cs = getComputedStyle(probe);
        return `${cs.color} on ${cs.backgroundColor}`;
      };
      const settle = () =>
        new Promise((resolve) => setTimeout(() => requestAnimationFrame(resolve), 50));
      const result = [];
      for (const theme of themes) {
        window.setTheme(theme);
        const immediate = read();
        await settle();
        result.push({ theme, immediate, settled: read() });
      }
      probe.remove();
      return result;
    }, THEMES);
    for (const { theme, immediate, settled } of reads) {
      expect(immediate, `${theme} colours read right after the switch`).toBe(settled);
    }
    expect(new Set(reads.map((r) => r.settled)).size, "each theme has its own colours").toBe(
      THEMES.length
    );
  });
});

test.describe("card chart colours from theme tokens", () => {
  test("the card chart grid and tooltip follow each of the four themes", async ({ page }) => {
    await gotoApp(page);
    const byTheme = await page.evaluate((themes) => {
      const host = document.createElement("div");
      host.style.width = "300px";
      host.innerHTML =
        '<div style="height:120px"><canvas class="card-a-canvas" data-metal="Silver" data-weight="1"' +
        ' data-qty="1" data-purity="0.999" data-price="30" data-market="35" data-date="2026-09-01"></canvas></div>';
      document.body.appendChild(host);
      const result = {};
      for (const theme of themes) {
        window.setTheme(theme);
        _initCardCharts(host);
        const chart = Chart.getChart(host.querySelector("canvas"));
        const border = getThemeColorRGB("border");
        result[theme] = {
          grid: chart.options.scales.y.grid.color,
          tooltipBg: chart.options.plugins.tooltip.backgroundColor,
          tooltipTitle: chart.options.plugins.tooltip.titleColor,
          tooltipBody: chart.options.plugins.tooltip.bodyColor,
          expectedGrid: resolveColor(`color-mix(in srgb, ${border} 40%, transparent)`),
          expectedBg: getThemeColorRGB("bg-primary"),
          expectedText: getThemeColorRGB("text-primary"),
        };
      }
      host.remove();
      return result;
    }, THEMES);
    for (const theme of THEMES) {
      const c = byTheme[theme];
      expect(c.grid, `${theme} grid reads --border`).toBe(c.expectedGrid);
      expect(c.tooltipBg, `${theme} tooltip surface reads --bg-primary`).toBe(c.expectedBg);
      expect([c.tooltipTitle, c.tooltipBody], `${theme} tooltip text reads --text-primary`).toEqual(
        [c.expectedText, c.expectedText]
      );
    }
    expect(byTheme.light.tooltipBg, "the tooltip surface differs by theme").not.toBe(
      byTheme.dark.tooltipBg
    );
  });
});

// STRK-450: status colours set from JS come from per-theme tokens and meet WCAG AA.
//
// Covers the Numista bulk sync table status cells (Synced / Needs sync / Failed), the sync
// activity log lines (success / warn / error) and the spot lookup flash on a price input.
// Each is measured in all four themes, switched in place. The measure composites a
// translucent background over the nearest opaque ancestor before taking the ratio.

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

/** Mounts the activity log container the sync log writes into, then logs one line per type. */
async function writeLogLines(page) {
  await page.evaluate(() => {
    const log = document.createElement("div");
    log.id = "numistaSyncLog";
    document.getElementById("numistaSyncTableContainer").appendChild(log);
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

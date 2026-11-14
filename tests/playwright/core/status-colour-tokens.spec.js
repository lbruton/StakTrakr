// Colours that JS used to pick come from per-theme tokens and meet WCAG AA.
//
// STRK-450 covers the Numista bulk sync table status cells (Synced / Needs sync / Failed),
// the sync activity log lines (success / warn / error) and the spot lookup flash on a price
// input. STRK-452 covers the metal-tinted Item View header. Each is measured in all four
// themes, switched in place. The measure composites a translucent background over the
// nearest opaque ancestor before taking the ratio.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { suppressWhatsNewPopup } from "../helpers/seed.js";
import { showSampleDiffReview } from "../helpers/diff-review.js";
import {
  THEMES,
  AA_NORMAL_TEXT,
  applyTheme,
  measureText,
  contrastFailures,
} from "../helpers/contrast.js";
import { collectionItem, seedCollectionsPage } from "../helpers/collections-fixtures.js";

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

test.describe("status colours from theme tokens", () => {
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
      await applyTheme(page, theme);
      expectDistinctAa(await measureText(page, statusCells), theme, "status");
    }
  });

  test("sync log lines meet AA and differ by type in all four themes", async ({ page }) => {
    await writeLogLines(page);
    for (const theme of THEMES) {
      await applyTheme(page, theme);
      expectDistinctAa(await measureText(page, "#numistaSyncLog .cache-log-line"), theme, "log");
    }
  });

  test("spot lookup flash is visible, keeps the input text AA, and clears", async ({ page }) => {
    await page.addStyleTag({ content: "#itemPrice { transition: none !important; }" });
    for (const theme of THEMES) {
      await applyTheme(page, theme);
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
      await applyTheme(page, theme);
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

test.describe("metal-tinted Item View header", () => {
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

// Shared motion must work both as a complete transition and after a property name.
test.describe("shared control transitions", () => {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    test(`controls complete hover, focus and disclosure feedback with ${reducedMotion} motion`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120000);
      await page.emulateMedia({ reducedMotion });
      await suppressWhatsNewPopup(page);
      await page.goto("/index.html#/inventory");
      await page.locator("#newItemBtn").click();
      await expect(page.locator("#itemModal")).toBeVisible();
      const summary = page.locator("#attachmentsSection > summary");
      await summary.click();
      await page
        .locator("#attachmentFileInput")
        .setInputFiles("tests/playwright/helpers/test-obverse.png");
      const action = page.locator("#attachmentQueuedList .attach-btn").first();
      await expect(action).toBeVisible();

      const sharedProperties = [
        "background-color",
        "color",
        "border-color",
        "box-shadow",
        "opacity",
        "transform",
      ];
      const settle = async (locator) => {
        await locator.evaluate(async (el) => {
          // Flush styles before collecting the running CSS transitions, including pseudos.
          getComputedStyle(el).transform;
          await Promise.all(
            el.getAnimations({ subtree: true }).map((animation) => animation.finished)
          );
        });
      };
      const read = (locator, property, pseudo = null) =>
        locator.evaluate(
          (el, args) => getComputedStyle(el, args.pseudo).getPropertyValue(args.property),
          {
            property,
            pseudo,
          }
        );
      const expectTiming = async (
        locator,
        properties,
        pseudo = null,
        easing = "cubic-bezier(0.4, 0, 0.2, 1)"
      ) => {
        const style = await locator.evaluate((el, pseudo) => {
          const cs = getComputedStyle(el, pseudo);
          return {
            properties: cs.transitionProperty.split(", "),
            durations: cs.transitionDuration.split(", "),
            delays: cs.transitionDelay.split(", "),
            easings: cs.transitionTimingFunction,
          };
        }, pseudo);
        expect(style.properties).toEqual(properties);
        expect(
          style.durations.every((value) => value === (reducedMotion === "reduce" ? "0s" : "0.2s"))
        ).toBe(true);
        expect(style.delays.every((value) => value === "0s")).toBe(true);
        expect(style.easings).toContain(easing);
      };

      for (const theme of THEMES) {
        await test.step(theme, async () => {
          await page.evaluate((theme) => window.setTheme(theme), theme);
          await settle(page.locator("#itemModal"));
          const button = page.locator("#itemModalSubmit");
          const input = page.locator("#itemName");
          const drop = page.locator("#attachmentDropZone");
          const browse = page.locator("#attachmentBrowseBtn");
          await expectTiming(button, sharedProperties);
          // The existing form-specific override is part of the acceptance contract.
          await expectTiming(input, ["background", "border-color", "box-shadow"], null, "ease");
          await expectTiming(summary, ["background-color"]);
          await expectTiming(summary, ["transform"], "::after");
          await expectTiming(drop, ["border-color", "background-color"]);
          await expectTiming(browse, ["background-color", "border-color"]);
          await expectTiming(action, ["background-color", "color"]);

          // Focus changes the real form field's border, then blur restores its resting state.
          await button.focus();
          await settle(input);
          const border = await read(input, "border-color");
          await input.focus();
          await settle(input);
          expect(await read(input, "border-color")).not.toBe(border);
          await button.focus();
          await settle(input);
          expect(await read(input, "border-color")).toBe(border);

          const openTransform = await read(summary, "transform", "::after");
          await summary.click();
          await settle(summary);
          expect(await read(summary, "transform", "::after")).not.toBe(openTransform);
          await summary.click();
          await settle(summary);
          expect(await read(summary, "transform", "::after")).toBe(openTransform);

          for (const [target, property] of [
            [button, "transform"],
            [drop, "background-color"],
            // Transition events report the longhand for the border-color shorthand.
            [browse, "border-top-color"],
            [action, "background-color"],
          ]) {
            // Moving to the input also exits the drop zone before recording its resting state.
            await input.hover();
            await settle(target);
            const rest = await read(target, property);
            let hovered;
            for (let repeat = 0; repeat < 2; repeat++) {
              if (reducedMotion === "no-preference") {
                await target.evaluate((el, property) => {
                  el.dataset.observedTransition = "";
                  // Record before hovering: CI may resume after the 200ms effect has finished.
                  const record = (event) => {
                    if (
                      event.target !== el ||
                      event.pseudoElement ||
                      event.propertyName !== property
                    )
                      return;
                    el.dataset.observedTransition = event.propertyName;
                    el.removeEventListener("transitionrun", record);
                  };
                  el.addEventListener("transitionrun", record);
                }, property);
              }
              await target.hover();
              await settle(target);
              if (reducedMotion === "no-preference") {
                await expect(target).toHaveAttribute("data-observed-transition", property);
              }
              const actual = await read(target, property);
              expect(actual).not.toBe(rest);
              if (repeat) expect(actual).toBe(hovered);
              hovered = actual;
              await input.hover();
              await settle(target);
              expect(await read(target, property)).toBe(rest);
            }
          }
          if (process.env.MOTION_EVIDENCE) {
            for (const [name, width, height] of [
              ["desktop", 1440, 1000],
              ["phone", 390, 844],
            ]) {
              await page.setViewportSize({ width, height });
              await browse.scrollIntoViewIfNeeded();
              await page.screenshot({
                path: testInfo.outputPath(`controls-${theme}-${name}-${reducedMotion}.png`),
              });
            }
            await page.setViewportSize({ width: 1440, height: 1000 });
          }
        });
      }
    });
  }
});

/** Seeds a silver Item bought far below spot and a gold Item bought far above it. */
async function gotoDashboardWithGainAndLoss(page) {
  const base = { qty: 1, weightUnit: "oz", purity: 0.999, type: "Round", date: "2026-04-01" };
  const items = [
    { ...base, uuid: "dash-gain", serial: 1, name: "Silver Gain Round", metal: "Silver" },
    { ...base, uuid: "dash-loss", serial: 2, name: "Gold Loss Round", metal: "Gold" },
  ];
  Object.assign(items[0], { composition: "Silver", weight: 10, price: 1 });
  Object.assign(items[1], { composition: "Gold", weight: 1, price: 100000 });
  await page.addInitScript((inv) => {
    localStorage.setItem("metalInventory", JSON.stringify(inv));
  }, items);
  await suppressWhatsNewPopup(page);
  await page.goto("/index.html");
  await expect(page.locator("#lossProfitSilver")).toContainText("$");
  await expect(page.locator("#lossProfitGold")).toContainText("-");
  await expect(page.locator("#bestPriceTickerEl .ticker-track")).toHaveCount(1);
  await expect(page.locator(".spot-ratio-chip.metal-gold .lab")).toHaveText("GB");
}

// Each selector names Dashboard text whose colour carries a status or a metal mark, plus
// the stack headline, whose figures sit on their own surface.
const DASHBOARD_STATUS_TEXT = {
  "stack headline title": "#totalsSectionEl h2",
  "stack headline label": "#stackHeadlineFigures .stack-figure-label",
  "stack headline value": "#stackHeadlineFigures .stack-figure-value",
  "stack headline status": "#stackHeadlineFigures dd > span",
  "stack headline context": "#stackHeadlineFigures .stack-figure-sub",
  "stack weights": "#stackWeights li > span:not(.totals-metal-mark)",
  "stack activity": "#stackActivity, #stackActivity > span",
  "totals header": "#totalsLedger thead th",
  "totals metal": "#totalsLedger .total-title-btn",
  "totals figure": "#totalsLedger .total-value",
  "gain/loss value": "#totalsLedger .totals-col-gain > span",
  "gain/loss percent": "#tabViewDashboard .gain-loss-pct",
  "spot change": "#tabViewDashboard .spot-card-change span",
  "ticker price": ".ticker-block[data-ticker-block='primary'] .ticker-item .price",
  "ticker premium": ".ticker-block[data-ticker-block='primary'] .ticker-item .premium",
  "goldback chip": ".spot-ratio-chip.metal-gold .lab",
  "inventory gain/loss": "#inventoryTable td[data-column='gainLoss']",
};

/** Waits until at least four spot cards have a drawn sparkline chart. */
async function expectDrawnSparklines(page) {
  await expect
    .poll(() =>
      page
        .locator("#tabViewDashboard .spot-sparkline")
        .evaluateAll(
          (canvases) => canvases.filter((c) => c.width > 0 && window.Chart?.getChart(c)).length
        )
    )
    .toBeGreaterThanOrEqual(4);
}

test.describe("Dashboard status text from theme tokens", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboardWithGainAndLoss(page);
  });

  test("gain, loss, change, ticker and chip text meet AA with no inline colour in all four themes", async ({
    page,
  }) => {
    await expect(page.locator("#totalsLedger .totals-col-gain > .gl-gain").first()).toBeVisible();
    await expect(page.locator("#totalsLedger .totals-col-gain > .gl-loss").first()).toBeVisible();
    for (const theme of THEMES) {
      await applyTheme(page, theme);
      await expect
        .poll(() => contrastFailures(page, DASHBOARD_STATUS_TEXT), {
          message: `${theme} Dashboard status text`,
        })
        .toEqual([]);
    }
  });

  test("spot prices use the primary text colour and the change line carries the trend", async ({
    page,
  }) => {
    const values = "#tabViewDashboard .spot-card-value";
    await expect(page.locator(values).first()).toContainText(/[▲▼=] \$/);
    for (const theme of THEMES) {
      await applyTheme(page, theme);
      const textPrimary = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--text-primary)";
        document.body.appendChild(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      });
      await expect
        .poll(
          async () =>
            (await measureText(page, values))
              .filter((r) => r.color !== textPrimary)
              .map((r) => `${r.text} ${r.color}`),
          { message: `${theme} spot prices are ${textPrimary}` }
        )
        .toEqual([]);
    }
  });

  test("each sparkline spends its plot height on the data range", async ({ page }) => {
    await expectDrawnSparklines(page);
    const charts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#tabViewDashboard .spot-sparkline"))
        .filter((canvas) => canvas.clientHeight > 0)
        .map((canvas) => window.Chart?.getChart(canvas))
        .filter(Boolean)
        .map((chart) => {
          const ys = chart.data.datasets[0].data.map((p) => p.y);
          const { min, max } = chart.scales.y;
          return {
            id: chart.canvas.id,
            plotHeight: chart.chartArea.height,
            spread: (max - min) / (Math.max(...ys) - Math.min(...ys)),
            inside: min <= Math.min(...ys) && max >= Math.max(...ys),
          };
        })
    );
    // A spread near 1 means the axis hugs the data; Chart.js tick rounding can double it.
    const failures = charts
      .filter((c) => c.plotHeight < 40 || c.spread > 1.15 || !c.inside)
      .map(
        (c) => `${c.id} plot ${c.plotHeight}px spread ${c.spread.toFixed(2)} inside ${c.inside}`
      );
    expect(failures).toEqual([]);
  });

  test("no spot card text sits over its sparkline", async ({ page }) => {
    await expectDrawnSparklines(page);
    const overlaps = await page.evaluate(() => {
      const found = [];
      const textSelector =
        ".spot-card-label, .spot-card-period, .spot-card-value, .spot-card-change, .spot-ratio-chip, .spot-card-timestamp";
      for (const card of document.querySelectorAll("#tabViewDashboard .spot-card")) {
        const canvas = card.querySelector(".spot-sparkline");
        const c = canvas.getBoundingClientRect();
        if (!c.width || !c.height) continue;
        for (const el of card.querySelectorAll(textSelector)) {
          const t = el.getBoundingClientRect();
          const overlapX = Math.min(c.right, t.right) - Math.max(c.left, t.left);
          const overlapY = Math.min(c.bottom, t.bottom) - Math.max(c.top, t.top);
          if (overlapX > 0.5 && overlapY > 0.5) {
            found.push(
              `${card.dataset.metal} ${el.className} overlaps by ${Math.round(overlapY)}px`
            );
          }
        }
      }
      return found;
    });
    expect(overlaps).toEqual([]);
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

const FILL_ROLES = ["primary", "secondary", "success", "info", "warning", "danger"];

// A static .modal host, so the shell rules apply without the fixed overlay.
const SHELL_HOST =
  '<div class="modal" style="position:static;display:block;width:auto;height:auto;padding:0;background:none;animation:none">';

// Each entry renders one filled control, or one control that fills on hover, with its own
// selector context. The element marked data-probe is measured at rest and on hover.
const FILLED_CONTROLS = {
  "primary button": '<button class="btn" data-probe>Save</button>',
  "secondary button": '<button class="btn secondary" data-probe>Cancel</button>',
  "success button": '<button class="btn success" data-probe>Export</button>',
  "info button": '<button class="btn info" data-probe>Print</button>',
  "warning button": '<button class="btn warning" data-probe>Review</button>',
  "premium button": '<button class="btn premium" data-probe>Premium</button>',
  "filters button": '<button class="btn filters" data-probe>Filters</button>',
  "danger button": '<button class="btn danger" data-probe>Delete</button>',
  "collection pill": '<button class="btn collections-btn-pill" data-probe>Create</button>',
  "active sort chip": '<button class="chip-sort-btn active" data-probe>A-Z</button>',
  "active settings nav": '<div class="settings-nav-item active" data-probe>Appearance</div>',
  "active theme option": '<button class="theme-option active" data-probe>Dark</button>',
  "active pattern mode": '<button class="pattern-mode-btn active" data-probe>Pattern</button>',
  "active chart range": '<button class="view-chart-range-pill active" data-probe>1Y</button>',
  "active retail range": '<button class="retail-tf-btn active" data-probe>7D</button>',
  "active chart metric": '<button class="chart-metric-btn active" data-probe>Value</button>',
  "active date N/A": '<button class="date-na-btn active" data-probe>N/A</button>',
  "active market pill":
    '<button class="market-filter-pill active" data-metal="all" data-probe>All</button>',
  "grade chip": '<span class="cv-chip-grade" data-probe>MS70</span>',
  "tags chip": '<span class="cv-chip-tags" data-probe>3 tags</span>',
  "bulk count badge": '<span class="bulk-edit-count-badge" data-probe>4</span>',
  "attachment count": '<span class="attach-panel-count" data-probe>2</span>',
  "form section count": '<span class="form-section-count" data-probe>5</span>',
  "toggle all": '<button class="toggle-all-btn" data-probe>Toggle all</button>',
  "save all": '<button class="save-all-btn" data-probe>Save all</button>',
  "cancel all": '<button class="cancel-all-btn" data-probe>Cancel all</button>',
  "clear filters": '<button class="filter-clear-btn" data-probe>Clear</button>',
  "chip confirm": '<button class="chip-confirm-yes" data-probe>Yes</button>',
  "recovery restore":
    '<button class="inventory-recovery-banner__btn--primary" data-probe>Restore</button>',
  "trade save":
    '<div class="trade-edit-actions"><button class="btn-sm save" data-probe>Save</button></div>',
  "provider badge": '<span class="provider-badge free" data-probe>Free</span>',
  "view footer primary":
    '<div class="view-modal-footer"><button class="view-footer-btn primary" data-probe>Edit</button></div>',
  "view footer danger":
    '<div class="view-modal-footer"><button class="view-footer-btn danger" data-probe>Remove</button></div>',
  "settings action": '<button class="settings-action-btn" data-probe>Run</button>',
  "save filter": '<button class="save-filter-btn" data-probe>Save filter</button>',
  "search add": '<button class="search-action-btn add-btn" data-probe>Add</button>',
  "search clear": '<button class="search-action-btn clear-btn" data-probe>Clear</button>',
  "search log": '<button class="search-action-btn log-btn" data-probe>Log</button>',
  "api action": '<button class="btn api-action-btn" data-probe>Test</button>',
  "history button": '<button class="btn api-action-btn btn-history" data-probe>History</button>',
  "action primary":
    '<button class="btn api-action-btn btn-action-primary" data-probe>Sync</button>',
  "numista tag": '<button class="numista-tag" data-probe>Bullion</button>',
  "toggle key": '<button class="btn-toggle-key" data-probe>Show</button>',
  "image upload": '<button class="btn img-btn-upload" data-probe>Upload</button>',
  "stale sync": '<button class="market-sync-btn stale" data-probe>Sync</button>',
  "footer cancel": `${SHELL_HOST}<div class="modal-shell-footer"><button class="btn secondary" data-probe>Cancel</button></div></div>`,
  "shell title": `${SHELL_HOST}<div class="modal-shell-header"><h2 class="modal-shell-title" data-probe>History</h2></div></div>`,
  "shell close": `${SHELL_HOST}<div class="modal-shell-header"><button class="modal-shell-close" data-probe>×</button></div></div>`,
  "settings link":
    '<div class="settings-section-panel"><a href="#sample" data-probe>Download sample CSV</a></div>',
};

/** Renders every filled control in one fixed host above the app, with transitions off. */
async function renderFilledControls(page) {
  await page.addStyleTag({
    content: "#fillProbeHost, #fillProbeHost * { transition: none !important; }",
  });
  await page.evaluate((controls) => {
    const host = document.createElement("div");
    host.id = "fillProbeHost";
    host.style.cssText =
      "position:fixed;inset:0;z-index:99999;display:flex;flex-wrap:wrap;gap:8px;" +
      "align-content:flex-start;padding:8px;overflow:auto;background:var(--bg-primary)";
    for (const [name, html] of Object.entries(controls)) {
      const cell = document.createElement("div");
      cell.dataset.control = name;
      cell.append(...new DOMParser().parseFromString(html, "text/html").body.childNodes);
      host.appendChild(cell);
    }
    document.body.appendChild(host);
  }, FILLED_CONTROLS);
}

/** Returns the label and fill colours resolved from one theme's fill tokens. */
function readFillTokens(page) {
  return page.evaluate((roles) => {
    const probe = document.createElement("span");
    probe.textContent = "probe";
    document.body.appendChild(probe);
    const read = (fill, ink) => {
      probe.style.cssText = `color: var(${ink}); background-color: var(${fill});`;
      return getComputedStyle(probe).backgroundColor + " | " + getComputedStyle(probe).color;
    };
    const out = {};
    for (const role of roles) {
      out[role] = {
        rest: read(`--${role}-fill`, `--on-${role}`),
        hover: read(`--${role}-fill-hover`, `--on-${role}`),
      };
    }
    probe.remove();
    return out;
  }, FILL_ROLES);
}

test.describe("filled controls from fill tokens", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("each fill token pair meets AA at rest and on hover in all four themes", async ({
    page,
  }) => {
    const pairs = Object.fromEntries(
      FILL_ROLES.flatMap((role) => [
        [`${role} rest`, `#fillTokenProbe [data-role="${role}"][data-state="rest"]`],
        [`${role} hover`, `#fillTokenProbe [data-role="${role}"][data-state="hover"]`],
      ])
    );
    await page.evaluate((roles) => {
      const host = document.createElement("div");
      host.id = "fillTokenProbe";
      host.style.cssText = "transition:none;background:var(--bg-primary)";
      for (const role of roles) {
        for (const [state, fill] of [
          ["rest", `--${role}-fill`],
          ["hover", `--${role}-fill-hover`],
        ]) {
          const el = document.createElement("span");
          el.dataset.role = role;
          el.dataset.state = state;
          el.textContent = `${role} ${state}`;
          el.style.cssText = `transition:none;color:var(--on-${role});background-color:var(${fill})`;
          host.appendChild(el);
        }
      }
      document.body.appendChild(host);
    }, FILL_ROLES);
    for (const theme of THEMES) {
      await applyTheme(page, theme);
      // An inline style is set on the probes themselves, so ignore that column of the report.
      const failures = (await contrastFailures(page, pairs)).filter((f) => !f.includes(" inline "));
      expect(failures, `${theme} fill token pairs`).toEqual([]);
      const tokens = await readFillTokens(page);
      for (const role of FILL_ROLES) {
        expect(tokens[role].hover, `${theme} ${role} hover differs from rest`).not.toBe(
          tokens[role].rest
        );
      }
    }
  });

  test("filled buttons, active chips and badges meet AA at rest and on hover in all four themes", async ({
    page,
  }) => {
    test.setTimeout(test.info().timeout * 2);
    await renderFilledControls(page);
    const names = Object.keys(FILLED_CONTROLS);
    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await applyTheme(page, theme);
        const failures = [];
        for (const name of names) {
          const selector = `#fillProbeHost [data-control="${name}"] [data-probe]`;
          for (const state of ["rest", "hover"]) {
            if (state === "rest") await page.mouse.move(0, 0);
            else await page.locator(selector).hover();
            const [{ ratio }] = await measureText(page, selector);
            if (ratio < AA_NORMAL_TEXT) failures.push(`${name} ${state} ${ratio.toFixed(2)}`);
          }
        }
        expect(failures, `${theme} filled controls`).toEqual([]);
      });
    }
  });

  test("no rule colours text with a fill token or puts a label on a raw fill", async ({ page }) => {
    const offences = await page.evaluate(() => {
      // A fill token as the colour, with or without a fallback.
      const rawText = /^var\(--(?:primary|secondary|success|info|warning|danger)(?:-hover)?\s*[,)]/;
      // A solid or gradient fill painted straight from a role token, outside color-mix().
      const rawFill =
        /(?:^|[\s,(])var\(--(?:primary|secondary|success|info|warning|danger)(?:-hover)?\)/;
      // Drops each color-mix(...) call, nested parentheses included.
      const withoutColorMix = (value) => {
        let out = "";
        let i = 0;
        while (i < value.length) {
          if (!value.startsWith("color-mix(", i)) {
            out += value[i++];
            continue;
          }
          i += "color-mix".length;
          let depth = 0;
          do {
            if (value[i] === "(") depth++;
            else if (value[i] === ")") depth--;
            i++;
          } while (depth > 0 && i < value.length);
        }
        return out;
      };
      const walk = (rules) =>
        rules.flatMap((rule) => [rule, ...(rule.cssRules ? walk([...rule.cssRules]) : [])]);
      const rules = [...document.styleSheets].flatMap((sheet) => {
        try {
          return walk([...sheet.cssRules]);
        } catch {
          return [];
        }
      });
      const out = [];
      for (const rule of rules) {
        if (!rule.style) continue;
        const color = rule.style.getPropertyValue("color").trim();
        if (rawText.test(color)) out.push(`${rule.selectorText}: color ${color}`);
        const background =
          rule.style.getPropertyValue("background-image") ||
          rule.style.getPropertyValue("background-color") ||
          rule.style.getPropertyValue("background");
        if (rawFill.test(withoutColorMix(background)) && color === "var(--text-inverse)") {
          out.push(`${rule.selectorText}: label on ${background.trim()}`);
        }
      }
      for (const el of document.querySelectorAll("[style]")) {
        const color = el.style.getPropertyValue("color").trim();
        if (rawText.test(color)) out.push(`${el.id || el.className || el.tagName}: color ${color}`);
      }
      return out;
    });
    expect(offences).toEqual([]);
  });
});

/** Turns transitions off so a read after a theme switch sees the new theme's colours. */
async function stopTransitions(page) {
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
}

/** Waits for open and fade-in animations, which start near opacity 0, to reach their end state. */
function settleAnimations(page) {
  return page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished)
    )
  );
}

const FRAME_SURFACES = ["bg-primary", "bg-secondary", "bg-tertiary", "bg-card", "bg-on-frame"];

test.describe("theme token gaps", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await stopTransitions(page);
  });

  test("muted text meets AA on every frame surface in all four themes", async ({ page }) => {
    await page.evaluate((surfaces) => {
      const host = document.createElement("div");
      host.id = "mutedProbe";
      for (const surface of surfaces) {
        const cell = document.createElement("div");
        cell.style.background = `var(--${surface})`;
        const text = document.createElement("span");
        text.dataset.surface = surface;
        text.className = "muted-probe";
        text.textContent = `muted on ${surface}`;
        cell.appendChild(text);
        host.appendChild(cell);
      }
      document.body.appendChild(host);
    }, FRAME_SURFACES);
    await page.addStyleTag({ content: "#mutedProbe .muted-probe { color: var(--text-muted); }" });
    const selectors = Object.fromEntries(
      FRAME_SURFACES.map((s) => [s, `#mutedProbe [data-surface="${s}"]`])
    );
    for (const theme of THEMES) {
      await applyTheme(page, theme);
      expect(await contrastFailures(page, selectors), `${theme} muted text`).toEqual([]);
    }
  });

  test("status titles and the Owned tag meet AA in all four themes", async ({ page }) => {
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "ownedTagProbe";
      for (const surface of ["bg-card", "bg-secondary"]) {
        const cell = document.createElement("div");
        cell.style.background = `var(--${surface})`;
        cell.innerHTML = '<span class="collections-tag is-done">Owned</span>';
        host.appendChild(cell);
      }
      document.body.appendChild(host);
    });
    const selectors = {
      "Honest Limitations title": ".faq-limitations-title",
      "Danger Zone title": ".danger-zone-title",
      "Owned tag": "#ownedTagProbe .collections-tag.is-done",
    };
    for (const theme of THEMES) {
      await applyTheme(page, theme);
      expect(await contrastFailures(page, selectors), `${theme} status titles`).toEqual([]);
    }
  });

  test("diff review text meets AA in all four themes", async ({ page }) => {
    test.setTimeout(test.info().timeout * 2);
    await showSampleDiffReview(page);
    await expect(page.locator("#diffReviewModal")).toBeVisible();
    await expect(page.locator("#diffReviewModal .dm-qty-verb")).toHaveText([
      "Keep",
      "Replace",
      "Add to existing",
    ]);
    // Marks every rendered element that holds its own text, so one selector measures them all.
    const markText = () =>
      page.evaluate(() => {
        for (const el of document.querySelectorAll("#diffReviewModal [data-dm-text]")) {
          delete el.dataset.dmText;
        }
        for (const el of document.querySelectorAll("#diffReviewModal .modal-content *")) {
          const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          const shown = el.getClientRects().length && !el.closest(".collapsed");
          if (ownText && shown && !el.matches(":disabled")) {
            el.dataset.dmText = "";
          }
        }
      });
    const allText = { "diff review text": "#diffReviewModal [data-dm-text]" };
    const expectAA = async (state, selectors) => {
      await settleAnimations(page);
      await markText();
      for (const theme of THEMES) {
        await applyTheme(page, theme);
        const failures = (
          await contrastFailures(page, selectors, { ancestorOpacity: true })
        ).filter((f) => !f.includes(" inline "));
        expect(failures, `${theme} diff review ${state}`).toEqual([]);
      }
    };
    await expectAA("on open", {
      "Keep and Replace labels": "#diffReviewModal .dm-qty-verb",
      ...allText,
    });
    // A skipped Item card and a confirmed conflict card keep their text at AA.
    await page.evaluate(() => {
      const modal = document.getElementById("diffReviewModal");
      modal.querySelector('.dm-orphan-card [data-set-action="skip"]').click();
      modal.querySelector('[data-card-action="keep-remote"]').click();
      modal.querySelector('[data-card-action="resolve"]').click();
    });
    await expect(page.locator("#diffReviewModal .dm-orphan-card.skipped")).toHaveCount(1);
    await expect(page.locator("#diffReviewModal .dm-conflict-card.resolved")).toHaveCount(1);
    await expectAA("after Skip and Confirm", allText);
  });
});

// STRK-558: the image section sits on a light surface in light and sepia, so its labels and the
// grade chip must take theme tokens rather than fixed white and black fills.
test.describe("Item view image section from theme tokens", () => {
  test("OBVERSE and REVERSE labels and the PCGS grade chip meet AA in all four themes", async ({
    page,
  }) => {
    test.setTimeout(test.info().timeout * 2);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("https://images.example/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#999"/></svg>',
      })
    );
    // A PCGS token enables the verify control inside the chip.
    await page.addInitScript(() => {
      localStorage.setItem(
        "catalog_api_config",
        JSON.stringify({ pcgs: { bearerToken: "strk558-token" } })
      );
    });
    const cert = {
      gradingAuthority: "PCGS",
      grade: "MS 70",
      pcgsNumber: "1234",
      certNumber: "5678",
      obverseImageUrl: "https://images.example/frame.svg",
      reverseImageUrl: "https://images.example/frame.svg",
      ignorePatternImages: true,
    };
    const items = [
      { ...collectionItem("strk558-pcgs", "PCGS Round", "2024", 1), ...cert },
      {
        ...collectionItem("strk558-verified", "PCGS Verified Round", "2024", 2),
        ...cert,
        pcgsVerified: true,
      },
    ];
    await seedCollectionsPage(page, items);
    await page.waitForFunction(
      () => typeof window.showViewModal === "function" && window.inventory?.length > 0
    );
    await stopTransitions(page);
    const selectors = {
      "OBVERSE and REVERSE labels": "#viewItemModal .view-image-label",
      "PCGS grade chip": "#viewItemModal .view-cert-badge span",
    };
    for (const [index, state] of [
      [0, "unverified"],
      [1, "verified"],
    ]) {
      await page.evaluate((i) => window.showViewModal(i), index);
      await expect(page.locator("#viewItemModal .view-cert-badge")).toBeVisible();
      await settleAnimations(page);
      const verify = page.locator("#viewItemModal .view-cert-badge .view-cert-verify");
      await expect(verify).toHaveCount(1);
      if (state === "verified") await expect(verify).toHaveClass(/pcgs-verified/);
      for (const theme of THEMES) {
        await applyTheme(page, theme);
        expect(await contrastFailures(page, selectors), `${theme} ${state} image section`).toEqual(
          []
        );
        // The verify icon is non-text, so it needs 3:1 (WCAG 1.4.11), not 4.5:1.
        const icons = await measureText(page, "#viewItemModal .view-cert-badge .view-cert-verify");
        for (const icon of icons) {
          expect(icon.ratio, `${theme} ${state} verify icon`).toBeGreaterThanOrEqual(3);
        }
      }
      await page.evaluate(() => window.closeViewModal());
    }
  });
});

test.describe("contrast measure", () => {
  test("a faded opaque ancestor fades its text and its surface together", async ({ page }) => {
    await page.setContent(
      `<body style="margin:0;background:#fff">
        <div style="background:#000;opacity:0.5"><span id="t" style="color:#fff">Faded</span></div>
      </body>`
    );
    const [plain] = await measureText(page, "#t");
    expect(plain.ratio).toBeCloseTo(21, 1);
    const [faded] = await measureText(page, "#t", { ancestorOpacity: true });
    // White over 50% black on white renders white on mid-grey.
    expect(faded.ratio).toBeLessThan(AA_NORMAL_TEXT);
    expect(faded.ratio).toBeCloseTo(4, 0);
  });

  test("a translucent ancestor fill darkens the surface behind the text", async ({ page }) => {
    await page.setContent(
      `<body style="margin:0;background:#fff">
        <div style="background:rgba(0,0,0,0.5)"><span id="t" style="color:#777">Tinted</span></div>
      </body>`
    );
    const [tinted] = await measureText(page, "#t");
    // Grey text over 50% black on white sits on mid-grey, not on white.
    expect(tinted.ratio).toBeLessThan(2);
  });

  test("an element's own opacity fades its fill along with its text", async ({ page }) => {
    await page.setContent(
      `<body style="margin:0;background:#fff">
        <button id="t" style="background:#000;color:#fff;opacity:0.5">Half</button>
      </body>`
    );
    const [half] = await measureText(page, "#t");
    // The control renders as white on mid-grey, not as grey on black.
    expect(half.ratio).toBeCloseTo(3.98, 1);
    expect(half.background).toBe("rgb(128, 128, 128)");
  });
});

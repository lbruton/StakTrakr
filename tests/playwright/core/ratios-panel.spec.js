// STRK-270 — shared ratios panel component (Layout C), mount + interaction
// contract. No production host exists until STRK-271 (modal) / STRK-273
// (/ratios/ page), so these tests mount the component into a scratch element
// exactly the way a host will: window.renderRatiosPanel(el). Data comes from
// the real seed bundle loaded by the page (data/spot-history-bundle.js →
// historicalDataCache), so the joins and statistics are production-real.

import { test, expect } from "../helpers/mocks/extended-test.js";

const MOUNT = "#ratiosPanelTestMount";

test.describe("core/ratios-panel — shared Layout C component (STRK-270)", () => {
  /** @type {string[]} */
  let pageErrors;

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    await page.goto("/index.html");
    await page.waitForFunction(
      () =>
        typeof window.renderRatiosPanel === "function" &&
        window.historicalDataCache instanceof Map &&
        window.historicalDataCache.size > 0
    );
    await page.evaluate(() => {
      const mount = document.createElement("div");
      mount.id = "ratiosPanelTestMount";
      document.body.appendChild(mount);
      window.__ratiosPanelHandle = window.renderRatiosPanel(mount);
    });
  });

  test("mounts Layout C: pair selector, hero, labeled scales, tiles, chart, footer", async ({
    page,
  }) => {
    const panel = page.locator(`${MOUNT} .gsr-panel`);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-accent", "silver"); // Au:Ag default

    // In-panel pair selector: four real buttons, the active pair pressed.
    const pairButtons = page.locator(`${MOUNT} .gsr-pairs button`);
    await expect(pairButtons).toHaveCount(4);
    await expect(page.locator(`${MOUNT} [data-pair="au-ag"]`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Hero renders a real ratio from the bundle join.
    await expect(page.locator(`${MOUNT} .gsr-hero-num`)).toContainText(":1");
    await expect(page.locator(`${MOUNT} .gsr-hero-num`)).toContainText(/\d/);

    // Both scales are named — the 52-week bar and the all-time percentile.
    await expect(page.locator(`${MOUNT} .gsr-range .rhead .k`)).toHaveText("52-week range");
    await expect(page.locator(`${MOUNT} .gsr-range .rhead .pct`)).toContainText(
      "percentile all-time"
    );
    await expect(page.locator(`${MOUNT} .gsr-track .mark`)).toBeAttached();

    // Four signed-magnitude trend tiles, none aria-hidden (chart text alternative).
    await expect(page.locator(`${MOUNT} .gsr-tile`)).toHaveCount(4);
    await expect(page.locator(`${MOUNT} .gsr-tile[aria-hidden]`)).toHaveCount(0);

    // Chart canvas + range control, 90D default.
    await expect(page.locator(`${MOUNT} .gsr-canvas canvas`)).toBeAttached();
    await expect(page.locator(`${MOUNT} .gsr-tf button[data-r="90"]`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Provenance footer.
    await expect(page.locator(`${MOUNT} .gsr-foot`)).toContainText("both metals printed");
    await expect(page.locator(`${MOUNT} .gsr-foot`)).toContainText("Not investment advice");

    expect(pageErrors).toEqual([]);
  });

  test("switching pairs re-renders accent, aria-pressed, and header", async ({ page }) => {
    await page.locator(`${MOUNT} [data-pair="au-pt"]`).click();
    await expect(page.locator(`${MOUNT} .gsr-panel`)).toHaveAttribute("data-accent", "platinum");
    await expect(page.locator(`${MOUNT} [data-pair="au-pt"]`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.locator(`${MOUNT} [data-pair="au-ag"]`)).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await expect(page.locator(`${MOUNT} .gsr-head .eyebrow`)).toHaveText("Gold ÷ Platinum");
    // Pt/Pd pairs must NOT carry the Au:Ag interpretive verdict.
    await expect(page.locator(`${MOUNT} .gsr-range .rlegend`)).not.toContainText(
      "relatively cheaper against gold"
    );
    await expect(page.locator(`${MOUNT} .gsr-range .rlegend`)).toContainText("not a signal");
    expect(pageErrors).toEqual([]);
  });

  test("chart range control moves the pressed state without errors", async ({ page }) => {
    await page.locator(`${MOUNT} .gsr-tf button[data-r="max"]`).click();
    await expect(page.locator(`${MOUNT} .gsr-tf button[data-r="max"]`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.locator(`${MOUNT} .gsr-tf button[data-r="90"]`)).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(pageErrors).toEqual([]);
  });

  test("theme switch repaints the chart via the data-theme observer", async ({ page }) => {
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "light");
    });
    // The observer redraw is synchronous-enough; the canvas must survive and
    // no page error may fire from the token re-read.
    await expect(page.locator(`${MOUNT} .gsr-canvas canvas`)).toBeAttached();
    await page.waitForTimeout(100);
    expect(pageErrors).toEqual([]);
  });

  test("destroy() unmounts cleanly", async ({ page }) => {
    await page.evaluate(() => window.__ratiosPanelHandle.destroy());
    await expect(page.locator(`${MOUNT} .gsr-panel`)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});

// Header button retirement campaign (STRK-281 Phase 2) — one describe block per
// retired button. Each header shortcut is removed only once its function has a
// home elsewhere; these tests pin BOTH halves of that trade: the new affordance
// works, and the old button is genuinely gone (not merely hidden).
//
// STRK-283 — Trend: the per-card period chip (.spot-card-period) becomes the
// trend-period control. The chip already existed as a passive label; promoting
// it to a control is what allows #headerTrendBtn to retire. The hidden per-card
// <select> stays — it is the sparkline engine (js/card-view.js `_applyTrend`
// dispatches a synthetic change event that spot.js listens for), so asserting
// the selects move is what proves the sparklines still repaint.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const METALS = ["Silver", "Gold", "Platinum", "Palladium"];

/**
 * Boots the app with a deterministic starting trend period.
 *
 * The period seed is applied only when absent. addInitScript re-runs on every
 * navigation including reload(), so an unconditional write would silently
 * restore the default and make the persistence test unable to fail.
 */
async function gotoApp(page, { trendPeriod = "90", headerBtnOrder = null } = {}) {
  await page.addInitScript(
    ({ period, order }) => {
      if (localStorage.getItem("spotTrendPeriod") === null) {
        localStorage.setItem("spotTrendPeriod", period);
      }
      if (order) localStorage.setItem("headerBtnOrder", order);
    },
    { period: trendPeriod, order: headerBtnOrder }
  );
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#spotPriceDisplaySilver", { state: "visible" });
  await page.waitForFunction(() => typeof window.cycleSpotTrend === "function");
}

const readPeriodLabels = (page, metals) =>
  page.evaluate(
    (ms) => ms.map((m) => document.getElementById(`spotPeriod${m}`)?.textContent?.trim()),
    metals
  );

const readSelectValues = (page, metals) =>
  page.evaluate((ms) => ms.map((m) => document.getElementById(`spotRange${m}`)?.value), metals);

/** Opens Settings › Appearance, where the header button config table renders. */
async function openHeaderBtnConfig(page) {
  await page.evaluate(() => window.showSettingsModal("site"));
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator("#headerBtnConfigTable")).toBeVisible();
}

test.describe("STRK-283 — Trend header button retired to the spot-card period chip", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("the header Trend button no longer exists in the DOM", async ({ page }) => {
    await gotoApp(page);
    // count() not toBeHidden() — the button was previously present-but-hidden
    // (index.html shipped it with style="display:none" and applyHeaderToggleVisibility
    // revealed it), so a visibility assertion would have passed before the change.
    await expect(page.locator("#headerTrendBtn")).toHaveCount(0);
    await expect(page.locator("#headerTrendLabel")).toHaveCount(0);
  });

  test("every spot card exposes the period chip as a real, named control", async ({ page }) => {
    await gotoApp(page);
    for (const metal of METALS) {
      const chip = page.locator(`#spotPeriod${metal}`);
      await expect(chip).toBeVisible();
      // A native <button> so Enter/Space and focus come from the platform
      // rather than a delegated keydown handler we would have to maintain.
      await expect(chip).toHaveJSProperty("tagName", "BUTTON");
      await expect(chip).toHaveAttribute("type", "button");
      // The visible text is just "90d"; the accessible name must say what
      // activating it does, and must track the current value.
      await expect(chip).toHaveAttribute("aria-label", /trend period/i);
      await expect(chip).toHaveAttribute("aria-label", /90d/);
    }
  });

  test("clicking one card's chip cycles the period on all four cards", async ({ page }) => {
    await gotoApp(page, { trendPeriod: "90" });
    expect(await readPeriodLabels(page, METALS)).toEqual(["90d", "90d", "90d", "90d"]);

    // TREND_PRESETS order is 1,7,30,90,365,... so 90 advances to 365 ("1Y").
    await page.locator("#spotPeriodGold").click();

    expect(await readPeriodLabels(page, METALS)).toEqual(["1Y", "1Y", "1Y", "1Y"]);
    // The hidden per-card selects are the sparkline engine — if these did not
    // move, the labels would be lying and the charts would still show 90d.
    expect(await readSelectValues(page, METALS)).toEqual(["365", "365", "365", "365"]);
    await expect(page.locator("#spotPeriodGold")).toHaveAttribute("aria-label", /1Y/);
  });

  test("keyboard: Enter activates, Space activates without scrolling the page", async ({
    page,
  }) => {
    await gotoApp(page, { trendPeriod: "90" });

    await page.locator("#spotPeriodSilver").focus();
    await page.keyboard.press("Enter");
    expect(await readPeriodLabels(page, ["Silver"])).toEqual(["1Y"]);

    // Space on a native <button> activates and does not scroll; assert the
    // scroll position explicitly so a future switch to role="button" on a div
    // (which DOES scroll without preventDefault) cannot regress silently.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.keyboard.press(" ");
    expect(await readPeriodLabels(page, ["Silver"])).toEqual(["3Y"]);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the chosen period survives a reload", async ({ page }) => {
    await gotoApp(page, { trendPeriod: "90" });
    await page.locator("#spotPeriodSilver").click();
    expect(await readPeriodLabels(page, ["Silver"])).toEqual(["1Y"]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#spotPriceDisplaySilver", { state: "visible" });

    expect(await readPeriodLabels(page, METALS)).toEqual(["1Y", "1Y", "1Y", "1Y"]);
    expect(await readSelectValues(page, METALS)).toEqual(["365", "365", "365", "365"]);
  });

  test("Settings no longer offers a Trend row in the header button config", async ({ page }) => {
    await gotoApp(page);
    await openHeaderBtnConfig(page);
    // Scoped to the header-button table specifically — the same panel also
    // renders layout and view-modal section tables, so an unscoped text search
    // could match an unrelated row and pass vacuously.
    const table = page.locator("#headerBtnConfigTable");
    await expect(table).not.toContainText("Trend");
    // Sanity: the table did render, so the negative assertion is meaningful.
    await expect(table).toContainText("Settings");
  });

  test("a legacy saved button order containing trendBtn still loads cleanly", async ({ page }) => {
    // Existing users have `trendBtn` inside headerBtnOrder. getHeaderBtnConfig
    // filters saved ids with `k in vis`, so a retired id self-heals with no
    // migration — this pins that contract rather than assuming it.
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await gotoApp(page, {
      headerBtnOrder: JSON.stringify(["trendBtn", "themeBtn", "marketBtn", "currencyBtn"]),
    });

    await openHeaderBtnConfig(page);

    const table = page.locator("#headerBtnConfigTable");
    await expect(table).not.toContainText("Trend");
    await expect(table).toContainText("Theme");
    expect(errors).toEqual([]);
  });
});

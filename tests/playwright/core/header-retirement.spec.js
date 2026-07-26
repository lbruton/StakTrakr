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
async function gotoApp(
  page,
  { trendPeriod = "90", headerBtnOrder = null, spotPricingSource = null } = {}
) {
  await page.addInitScript(
    ({ period, order, source }) => {
      if (localStorage.getItem("spotTrendPeriod") === null) {
        localStorage.setItem("spotTrendPeriod", period);
      }
      if (order) localStorage.setItem("headerBtnOrder", order);
      // saveData/loadDataSync round-trip through JSON, so the seed must be
      // JSON-encoded or loadDataSync's parse throws and silently falls back.
      if (source) localStorage.setItem("spotPricingSource", JSON.stringify(source));
    },
    { period: trendPeriod, order: headerBtnOrder, source: spotPricingSource }
  );
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#spotPriceDisplaySilver", { state: "visible" });
  await page.waitForFunction(() => typeof window.cycleSpotTrend === "function");
}

/**
 * Reads the visible label on each metal's period chip.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string[]} metals - Metal suffixes, e.g. ["Silver", "Gold"]
 * @returns {Promise<Array<string|undefined>>} Trimmed chip text per metal, in order
 */
const readPeriodLabels = (page, metals) =>
  page.evaluate(
    (ms) => ms.map((m) => document.getElementById(`spotPeriod${m}`)?.textContent?.trim()),
    metals
  );

/**
 * Reads the hidden per-card range <select> values — the sparkline engine that
 * `_applyTrend` drives, so these moving is what proves the charts followed.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string[]} metals - Metal suffixes, e.g. ["Silver", "Gold"]
 * @returns {Promise<Array<string|undefined>>} Select value per metal, in order
 */
const readSelectValues = (page, metals) =>
  page.evaluate((ms) => ms.map((m) => document.getElementById(`spotRange${m}`)?.value), metals);

/**
 * Asserts every metal card sits at one trend period — both the visible chip
 * label and the hidden range select that actually drives the sparkline.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} label - Expected chip text, e.g. "1Y"
 * @param {string} value - Expected select value, e.g. "365"
 * @returns {Promise<void>}
 */
async function expectAllMetalsAtPeriod(page, label, value) {
  expect(await readPeriodLabels(page, METALS)).toEqual(METALS.map(() => label));
  expect(await readSelectValues(page, METALS)).toEqual(METALS.map(() => value));
}

/** Opens Settings › Appearance, where the header button config table renders. */
async function openHeaderBtnConfig(page) {
  await page.evaluate(() => window.showSettingsModal("site"));
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator("#headerBtnConfigTable")).toBeVisible();
}

/**
 * Shared assertion for a retired button's config row and its legacy stored id.
 *
 * Every retirement in this campaign repeats the same shape, so it lives here
 * once rather than being copy-pasted per button (five more are queued).
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {object} opts - Options
 * @param {string} opts.retiredLabel - Row label that must be gone, e.g. "Spot Sync"
 * @param {string} opts.retiredId - Config id that must be gone, e.g. "syncBtn"
 * @param {string[]} opts.survivingIds - Ids seeded alongside it that must survive
 * @param {string} opts.survivingLabel - A label that must still render, anchoring
 *   the negative assertion so it cannot pass on an empty table
 * @returns {Promise<void>}
 */
async function expectRetiredFromConfig(
  page,
  { retiredLabel, retiredId, survivingIds, survivingLabel }
) {
  await openHeaderBtnConfig(page);
  const table = page.locator("#headerBtnConfigTable");
  await expect(table).not.toContainText(retiredLabel);
  await expect(table).toContainText(survivingLabel);

  // Read-time filtering only — the retired id is still on disk until a write.
  const stillStored = await page.evaluate(() => localStorage.getItem("headerBtnOrder"));
  expect(stillStored).toContain(retiredId);

  // The first config write persists the already-filtered order.
  await page
    .locator("#headerBtnConfigTable input.inline-chip-toggle:not([disabled])")
    .first()
    .click();
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem("headerBtnOrder")))
    .not.toContain(retiredId);

  const repaired = await page.evaluate(() => localStorage.getItem("headerBtnOrder"));
  for (const id of survivingIds) expect(repaired).toContain(id);
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
    await expectAllMetalsAtPeriod(page, "90d", "90");

    // TREND_PRESETS order is 1,7,30,90,365,... so 90 advances to 365 ("1Y").
    await page.locator("#spotPeriodGold").click();

    // Asserting the hidden selects alongside the labels is the point: the
    // selects are the sparkline engine, so labels moving without them would
    // mean the charts silently stopped following.
    await expectAllMetalsAtPeriod(page, "1Y", "365");
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

    await expectAllMetalsAtPeriod(page, "1Y", "365");
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

  test("a legacy saved button order containing trendBtn self-heals", async ({ page }) => {
    // Existing users have `trendBtn` inside headerBtnOrder. getHeaderBtnConfig
    // filters saved ids with `k in vis`, so a retired id needs no migration —
    // this pins that contract rather than assuming it.
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await gotoApp(page, {
      headerBtnOrder: JSON.stringify(["trendBtn", "themeBtn", "marketBtn", "currencyBtn"]),
    });

    await expectRetiredFromConfig(page, {
      retiredLabel: "Trend",
      retiredId: "trendBtn",
      survivingIds: ["themeBtn", "marketBtn", "currencyBtn"],
      survivingLabel: "Theme",
    });
    expect(errors).toEqual([]);
  });
});

// STRK-284 — Spot Sync: unlike the Trend retirement, nothing new is built here.
// The per-card icon was already wired (js/events.js `setupSpotPriceListeners`)
// and already state-managed (js/api.js `updateSyncButtonStates`); only
// `.spot-card-controls { display: none }` hid it. So these tests guard the two
// things this patch can actually break: that the icon becomes visible, and that
// un-hiding its wrapper does NOT also expose the range <select> that STRK-283
// deliberately keeps hidden as the sparkline engine.
//
// The epic's "click = metal, shift-click = all" was dropped (user-confirmed):
// _performSingleProviderFetch returns all four metals in one payload, so a
// per-metal sync would repeat the same request and discard three results.
test.describe("STRK-284 — Spot Sync header button retired to the per-card refresh icon", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("the header Spot Sync button and its status dot no longer exist", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("#headerSyncBtn")).toHaveCount(0);
    await expect(page.locator("#headerSyncDot")).toHaveCount(0);
  });

  test("every spot card shows an enabled refresh icon", async ({ page }) => {
    await gotoApp(page);
    for (const metal of METALS) {
      const icon = page.locator(`#syncIcon${metal}`);
      await expect(icon).toBeVisible();
      await expect(icon).toHaveJSProperty("tagName", "BUTTON");
      // Default source is STAKTRAKR, a keyless public feed, so hasApi is true.
      await expect(icon).toBeEnabled();
      await expect(icon).toHaveAttribute("title", "Sync from API");
    }
  });

  test("un-hiding the controls does not expose the range select", async ({ page }) => {
    await gotoApp(page);
    // Regression guard for STRK-283: the <select> is the sparkline engine that
    // _applyTrend drives with a synthetic change event, not a user control. If
    // this fails, the fix un-hid the whole .spot-card-controls wrapper instead
    // of the icon alone, and two competing period controls are now on screen.
    for (const metal of METALS) {
      await expect(page.locator(`#spotRange${metal}`)).toBeHidden();
    }
    // The chip from STRK-283 remains the only visible period control, and it
    // must still drive the hidden selects.
    await expectAllMetalsAtPeriod(page, "90d", "90");
    await page.locator("#spotPeriodSilver").click();
    await expectAllMetalsAtPeriod(page, "1Y", "365");
    for (const metal of METALS) {
      await expect(page.locator(`#spotRange${metal}`)).toBeHidden();
    }
  });

  test("the refresh icon is keyboard focusable", async ({ page }) => {
    await gotoApp(page);
    await page.locator("#syncIconSilver").focus();
    await expect(page.locator("#syncIconSilver")).toBeFocused();
  });

  test("MANUAL pricing source disables the icon with an honest title", async ({ page }) => {
    // hasApi is false for MANUAL, so updateSyncButtonStates must both disable
    // the control and say why — an inert enabled-looking button would be a lie.
    await gotoApp(page, { spotPricingSource: "MANUAL" });
    for (const metal of METALS) {
      const icon = page.locator(`#syncIcon${metal}`);
      await expect(icon).toBeDisabled();
      await expect(icon).toHaveAttribute("title", "Configure API first");
    }
  });

  test("Settings no longer offers a Spot Sync row, and a legacy order self-heals", async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await gotoApp(page, {
      headerBtnOrder: JSON.stringify(["syncBtn", "themeBtn", "marketBtn"]),
    });

    // Both halves of the contract live in the shared helper: read-time filtering
    // leaves the retired id on disk, and the first config write removes it while
    // preserving the surviving ids.
    await expectRetiredFromConfig(page, {
      retiredLabel: "Spot Sync",
      retiredId: "syncBtn",
      survivingIds: ["themeBtn", "marketBtn"],
      survivingLabel: "Theme",
    });
    expect(errors).toEqual([]);
  });
});

// STRK-285 + STRK-286 — Backup and Restore. The purest Tier A retirement in the
// campaign: neither button ever performed an action. Both listeners were
// literally `showSettingsModal("system")` — two icons, one behaviour, opening a
// panel that already holds the whole import/export set. Retiring them removes a
// duplicated shortcut and nothing else, so the thing worth asserting is that the
// destination is still reachable.
//
// NOTE the panel is `settingsPanel_system`, not `_storage` as both issues
// originally said — corrected after reading the listeners.
test.describe("STRK-285/286 — Backup and Restore header buttons retired", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("neither header button exists any more", async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator("#headerVaultBtn")).toHaveCount(0);
    await expect(page.locator("#headerRestoreBtn")).toHaveCount(0);
  });

  // NAMING TRAP: the nav item is `data-section="system"` but its visible label
  // reads "Inventory" (index.html ~3479). The internal id and the user-facing
  // label disagree, which is why the first draft of this release's copy told
  // users to look for a "System" tab that does not exist. Assert on the
  // data-section; describe it to users as Inventory.
  test("backup and restore stay reachable via the visible settings nav control", async ({
    page,
  }) => {
    // The whole point of a Tier A retirement: the shortcut goes, the capability
    // does not. So the destination is reached by CLICKING the visible
    // `.settings-nav-item[data-section="system"]` control rather than jumping
    // straight to the panel — a purely programmatic assertion would keep
    // passing even if that nav item were broken, which is exactly the kind of
    // regression a retirement could cause.
    //
    // The modal itself is still opened via showSettingsModal(): clicking
    // #settingsBtn does NOT work under this project's fixture — verified on
    // unmodified dev, where the same click leaves #settingsModal at
    // display:none, so the gear's listener is never attached in this
    // environment. That is a pre-existing testability gap, not something this
    // PR introduced, and not something this test can paper over.
    await gotoApp(page);
    await page.evaluate(() => window.showSettingsModal());
    await expect(page.locator("#settingsModal")).toBeVisible();

    const systemNav = page.locator('.settings-nav-item[data-section="system"]');
    await expect(systemNav).toBeVisible();
    // Pin the visible label too — if it ever changes, the release copy that
    // points users here goes stale silently.
    await expect(systemNav).toContainText("Inventory");
    await systemNav.click();

    const panel = page.locator("#settingsPanel_system");
    await expect(panel).toBeVisible();

    // Real import AND export controls must be present — without this the test
    // would only prove a panel opened, not that backing up still works.
    for (const id of ["exportJsonBtn", "exportCsvBtn", "exportZipBtn", "importZipBtn"]) {
      await expect(panel.locator(`#${id}`)).toBeAttached();
    }
  });

  test("Settings drops the Backup row and a legacy order self-heals", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await gotoApp(page, {
      headerBtnOrder: JSON.stringify(["vaultBtn", "themeBtn", "marketBtn"]),
    });
    await expectRetiredFromConfig(page, {
      retiredLabel: "Backup",
      retiredId: "vaultBtn",
      survivingIds: ["themeBtn", "marketBtn"],
      survivingLabel: "Theme",
    });
    expect(errors).toEqual([]);
  });

  test("Settings drops the Restore row and a legacy order self-heals", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await gotoApp(page, {
      headerBtnOrder: JSON.stringify(["restoreBtn", "themeBtn", "marketBtn"]),
    });
    await expectRetiredFromConfig(page, {
      retiredLabel: "Restore",
      retiredId: "restoreBtn",
      survivingIds: ["themeBtn", "marketBtn"],
      survivingLabel: "Theme",
    });
    expect(errors).toEqual([]);
  });
});

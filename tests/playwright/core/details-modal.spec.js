// STRK-352 — Metal detail modal (Variant A "Stack Story") domain suite.
// New product domain: nothing owned `showDetailsModal`/#detailsModal before
// this redesign (zero prior coverage; valuation owns item-level math, not
// modal UI). Responsive/mobile assertions live in mobile-and-layout.spec.js.
//
// Written RED in Cohort B against the legacy pie modal: these tests encode the
// reconciled requirements (AC-1..AC-4, AC-9..AC-19, AC-21, AC-24), the layer-2
// daily-close pin, the D-3 generation race, the D-16 footer, and the
// active-display-currency rule. Structure/interaction assertions only — no
// text-presence-only checks (STRK-123 lesson).
//
// DOM contract pinned here for the implementation (C.5/C.6):
//   #dmHeroChart (canvas), #dmChartTooltip (external tooltip),
//   .dm-topbar/.dm-header[data-accent]/.dm-substats/.dm-kpis/.dm-kpi,
//   .dm-series-chip[data-series=basis|spot|buys], [data-range], [data-metric],
//   .dm-substrip, .dm-panel/.dm-panel-title/.dm-comp-bar/.dm-comp-row/.dm-comp-more,
//   .dm-ledger tbody tr[data-uuid], .dm-flash, .dm-ledger-note, .dm-foot, .dm-skel,
//   Chart datasets order: [0]=melt, [1]=basis, [2]=spot (per-metal), [3]=buys.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { suppressWhatsNewPopup } from "../helpers/seed.js";

// ── date + fixture helpers (local calendar frame, matching todayStr()) ──────

/** Local YYYY-MM-DD for today − n days (matches the app's local date frame). */
const localDayKey = (minusDays = 0) => {
  const d = new Date(Date.now() - minusDays * 86400000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** UTC YYYY-MM-DD for today − n days (spotHistory timestamps are bare UTC). */
const utcDayKey = (minusDays = 0) =>
  new Date(Date.now() - minusDays * 86400000).toISOString().slice(0, 10);

const mkItem = (overrides = {}) => ({
  uuid: overrides.uuid ?? `strk352-${Math.random().toString(36).slice(2, 8)}`,
  name: "Test Silver Round",
  metal: "Silver",
  composition: "Silver",
  qty: 1,
  type: "Round",
  weight: 1,
  weightUnit: "oz",
  price: 10,
  marketValue: 0,
  purity: 1,
  date: localDayKey(10),
  purchaseLocation: "apmex.com",
  storageLocation: "Safe",
  notes: "",
  serial: 1,
  ...overrides,
});

// Canonical seed — active silver 5.1 oz / cost 135, one disposed silver,
// gold + copper for All, disposed-only platinum, palladium empty forever.
const SEED_ITEMS = [
  mkItem({
    uuid: "s1",
    name: "Big Silver Bar",
    weight: 2,
    price: 50,
    date: localDayKey(5),
    purchaseLocation: "apmex.com",
  }),
  mkItem({
    uuid: "s2",
    name: "Maple Pair",
    qty: 2,
    weight: 1,
    price: 30,
    date: localDayKey(45),
    purchaseLocation: "monumentmetals.com",
  }),
  mkItem({
    uuid: "s3",
    name: "Mystery Round",
    weight: 1,
    price: 20,
    date: "",
    purchaseLocation: "ebay.com",
  }),
  mkItem({
    uuid: "s5",
    name: "Tiny Bit",
    weight: 0.1,
    price: 5,
    date: localDayKey(3),
    purchaseLocation: "herobullion.com",
  }),
  mkItem({
    uuid: "s4",
    name: "Sold Eagle",
    weight: 1,
    price: 40,
    date: localDayKey(40),
    purchaseLocation: "sdbullion.com",
    disposition: { type: "sold", date: localDayKey(8), amount: 70, realizedGainLoss: 30 },
  }),
  mkItem({
    uuid: "g1",
    name: "G5 Goldback",
    metal: "Gold",
    type: "Goldback",
    weight: 5,
    weightUnit: "gb",
    price: 40,
    date: localDayKey(20),
    purchaseLocation: "goldback.com",
  }),
  mkItem({
    uuid: "c1",
    name: "Copper Morgan",
    metal: "Copper",
    weight: 1,
    price: 5,
    date: localDayKey(15),
    purchaseLocation: "silvergoldbull.com",
  }),
  mkItem({
    uuid: "p1",
    name: "Platinum Maple",
    metal: "Platinum",
    weight: 1,
    price: 100,
    date: localDayKey(60),
    purchaseLocation: "apmex.com",
    disposition: { type: "sold", date: localDayKey(30), amount: 125, realizedGainLoss: 25 },
  }),
];

// live spot (raw-string keys read by fetchSpotPrice via parseFloat)
const SPOT_RAW = {
  spotSilver: "10",
  spotGold: "1000",
  spotPlatinum: "900",
  spotPalladium: "800",
  spotCopper: "0.3",
};

// yesterday carries TWO live intraday samples — the daily close MUST be the
// later one (layer-2 pin: latest live timestamp per day wins)
const SPOT_HISTORY = [
  {
    spot: 11,
    metal: "Silver",
    source: "api",
    provider: "test",
    timestamp: `${utcDayKey(1)} 09:00:00`,
  },
  {
    spot: 12,
    metal: "Silver",
    source: "api",
    provider: "test",
    timestamp: `${utcDayKey(1)} 15:00:00`,
  },
];

async function installSeed(page, overrides = {}) {
  const payload = {
    items: overrides.items ?? SEED_ITEMS,
    spotRaw: SPOT_RAW,
    spotHistory: overrides.spotHistory ?? SPOT_HISTORY,
    extraJson: overrides.extraJson ?? {},
  };
  await page.addInitScript((data) => {
    localStorage.setItem("metalInventory", JSON.stringify(data.items));
    localStorage.setItem("metalSpotHistory", JSON.stringify(data.spotHistory));
    Object.entries(data.spotRaw).forEach(([k, v]) => localStorage.setItem(k, v));
    Object.entries(data.extraJson).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  }, payload);
  await suppressWhatsNewPopup(page);
}

async function bootApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.appListenersReady === true);
}

async function openScope(page, metal) {
  await page.click(`.total-title[data-metal="${metal}"]`);
  await expect(page.locator("#detailsModal")).toBeVisible();
}

/** Waits for the two-phase open to finish rendering the chart. */
async function chartReady(page) {
  await page.waitForFunction(() => {
    const c = document.getElementById("dmHeroChart");
    return !!(c && window.Chart && window.Chart.getChart(c));
  });
}

// Chart introspection happens via inline page.evaluate callbacks — Playwright
// serializes the callback function itself, so no dynamic code strings exist.

// ── AC-1 / AC-2: shell + header ─────────────────────────────────────────────

test("AC-1: opening a totals title renders the Variant A shell with zero legacy pie DOM", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "All");
  const modal = page.locator("#detailsModal");
  await expect(modal.locator(".dm-topbar .modal-close")).toBeVisible();
  await expect(modal.locator(".dm-header")).toBeVisible();
  await expect(modal.locator(".dm-kpis")).toBeVisible();
  await expect(modal.locator("#dmHeroChart")).toBeVisible();
  await expect(modal.locator(".dm-ledger")).toBeVisible();
  await expect(modal.locator(".dm-foot")).toBeVisible();
  // legacy pie layout must be gone
  await expect(modal.locator("#typeChart")).toHaveCount(0);
  await expect(modal.locator("#locationChart")).toHaveCount(0);
  await expect(modal.locator(".details-grid")).toHaveCount(0);
  await expect(modal.locator(".chart-canvas-container")).toHaveCount(0);
});

test("AC-2: header carries scope title, accent, and summed-unit substats", async ({ page }) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await expect(page.locator("#detailsModalTitle")).toHaveText("Silver — Detailed Breakdown");
  await expect(page.locator("#detailsModal .dm-header")).toHaveAttribute("data-accent", "silver");
  // active silver units: s1(1) + s2(2) + s3(1) + s5(1) = 5 (s4 disposed excluded)
  await expect(page.locator("#detailsModal .dm-substats")).toContainText("5 items");
  await expect(page.locator("#detailsModal .dm-substats")).toContainText("5.10 oz");
});

// ── AC-3: KPI strip ─────────────────────────────────────────────────────────

test("AC-3: five KPI tiles; Unrealized matches the dashboard Gain figure; Realized always shown", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  const dashboardGain = (await page.locator("#lossProfitSilver").innerText()).trim();
  await openScope(page, "Silver");
  const kpis = page.locator("#detailsModal .dm-kpi");
  await expect(kpis).toHaveCount(5);
  const labels = page.locator("#detailsModal .dm-kpi-label");
  await expect(labels.nth(0)).toContainText(/purchase/i);
  await expect(labels.nth(1)).toContainText(/melt/i);
  await expect(labels.nth(2)).toContainText(/retail/i);
  await expect(labels.nth(3)).toContainText(/unrealized/i);
  await expect(labels.nth(4)).toContainText(/realized/i);
  // parity with the dashboard card (both derive from computeItemValuation)
  const unrealized = (await kpis.nth(3).locator(".dm-kpi-value").innerText()).trim();
  expect(dashboardGain).toContain(unrealized.replace(/[+−-]/g, "").trim());
  // Realized renders unconditionally (s4 realizedGainLoss 30)
  await expect(kpis.nth(4).locator(".dm-kpi-value")).toContainText("30");
});

// ── AC-4 + D-3: lifecycle ───────────────────────────────────────────────────

test("AC-4: close destroys the chart; reopen renders cleanly with no console errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  await page.click("#detailsCloseBtn");
  await expect(page.locator("#detailsModal")).toBeHidden();
  const destroyed = await page.evaluate(() => {
    const c = document.getElementById("dmHeroChart");
    return !c || !window.Chart.getChart(c);
  });
  expect(destroyed).toBe(true);
  await openScope(page, "Silver");
  await chartReady(page);
  expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
});

test("D-3: closing during a delayed load leaves no chart, DOM, or observer behind", async ({
  page,
}) => {
  await installSeed(page);
  // stall every year-file fetch so the day-map assembly hangs
  await page.route("**/spot-history-*.json", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await bootApp(page);
  await openScope(page, "Silver");
  await expect(page.locator("#detailsModal .dm-skel").first()).toBeVisible();
  await page.click("#detailsCloseBtn");
  await expect(page.locator("#detailsModal")).toBeHidden();
  // let the stalled promise resolve and the stale completion fire
  await page.waitForTimeout(3200);
  await expect(page.locator("#detailsModal")).toBeHidden();
  const clean = await page.evaluate(() => {
    const c = document.getElementById("dmHeroChart");
    return !c || !window.Chart.getChart(c);
  });
  expect(clean).toBe(true);
});

test("AC-21: skeletons show while series data loads, then give way to the chart", async ({
  page,
}) => {
  await installSeed(page);
  await page.route("**/spot-history-*.json", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await bootApp(page);
  await openScope(page, "Silver");
  await expect(page.locator("#detailsModal .dm-skel").first()).toBeVisible();
  await chartReady(page);
  await expect(page.locator("#detailsModal .dm-skel")).toHaveCount(0);
});

// ── AC-9 / AC-10 / AC-12: series chips ──────────────────────────────────────

test("AC-9/AC-12: basis and buys chips default on, toggle their datasets, expose aria-pressed", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  const basisChip = page.locator('#detailsModal .dm-series-chip[data-series="basis"]');
  const buysChip = page.locator('#detailsModal .dm-series-chip[data-series="buys"]');
  await expect(basisChip).toHaveAttribute("aria-pressed", "true");
  await expect(buysChip).toHaveAttribute("aria-pressed", "true");
  const basisVisible = () =>
    page.evaluate(() =>
      window.Chart.getChart(document.getElementById("dmHeroChart")).isDatasetVisible(1)
    );
  expect(await basisVisible()).toBe(true);
  await basisChip.click();
  await expect(basisChip).toHaveAttribute("aria-pressed", "false");
  expect(await basisVisible()).toBe(false);
});

test("AC-10: single-metal scope renders the spot overlay on y1; All disables the chip and axis", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  const spotChip = page.locator('#detailsModal .dm-series-chip[data-series="spot"]');
  await expect(spotChip).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => !!window.Chart.getChart(document.getElementById("dmHeroChart")).options.scales.y1
    )
  ).toBe(true);
  await page.click("#detailsCloseBtn");
  await openScope(page, "All");
  await chartReady(page);
  await expect(page.locator('#detailsModal .dm-series-chip[data-series="spot"]')).toBeDisabled();
  expect(
    await page.evaluate(() => {
      const y1 = window.Chart.getChart(document.getElementById("dmHeroChart")).options.scales.y1;
      return !y1 || y1.display === false;
    })
  ).toBe(true);
});

// ── AC-11: range pills ──────────────────────────────────────────────────────

test("AC-11: 1Y is the default range; switching to 30D shrinks the window and re-renders", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  await expect(page.locator('#detailsModal [data-range="1Y"]')).toHaveClass(/active/);
  const seriesLen = () =>
    page.evaluate(
      () =>
        window.Chart.getChart(document.getElementById("dmHeroChart")).data.datasets[0].data.length
    );
  const before = await seriesLen();
  await page.click('#detailsModal [data-range="30D"]');
  await expect(page.locator('#detailsModal [data-range="30D"]')).toHaveClass(/active/);
  const after = await seriesLen();
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);
});

// ── AC-13 / AC-14: tooltip, markers, ledger sync (real pointer events) ──────

test("AC-13: hovering the plot shows the external tooltip; a real marker click flashes its ledger rows (AC-14)", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  const box = await page.locator("#dmHeroChart").boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await expect(page.locator("#dmChartTooltip")).toBeVisible();
  // real click on the s2 acquisition marker (buys dataset = index 3)
  const marker = await page.evaluate(() => {
    const m = window.Chart.getChart(document.getElementById("dmHeroChart")).getDatasetMeta(3);
    const el = m.data[m.data.length - 2];
    return { x: el.x, y: el.y };
  });
  await page.mouse.click(box.x + marker.x, box.y + marker.y);
  await expect(page.locator("#detailsModal .dm-ledger tr.dm-flash").first()).toBeVisible();
});

test("AC-14: a marker whose acquisitions are all disposed is a no-op (no flash, no error)", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  const box = await page.locator("#dmHeroChart").boundingBox();
  // s4 (disposed) is the OLDEST silver buy → buys dataset index 0
  const marker = await page.evaluate(() => {
    const m = window.Chart.getChart(document.getElementById("dmHeroChart")).getDatasetMeta(3);
    return { x: m.data[0].x, y: m.data[0].y };
  });
  await page.mouse.click(box.x + marker.x, box.y + marker.y);
  await page.waitForTimeout(250);
  await expect(page.locator("#detailsModal .dm-ledger tr.dm-flash")).toHaveCount(0);
  expect(errors).toHaveLength(0);
});

// ── AC-15 display + layer-2 close + D-16 footer ─────────────────────────────

test("AC-15: substrip shows market, invested, buy count, and per-metal pace (no pace on All)", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  const strip = page.locator("#detailsModal .dm-substrip");
  await expect(strip).toContainText(/market/i);
  await expect(strip).toContainText(/invested/i);
  await expect(strip).toContainText(/buys/i);
  await expect(strip).toContainText(/pace/i);
  await page.click("#detailsCloseBtn");
  await openScope(page, "All");
  await chartReady(page);
  await expect(page.locator("#detailsModal .dm-substrip")).not.toContainText(/pace/i);
});

test("layer-2 pin: the daily close is the LATEST live sample of the day", async ({ page }) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  // yesterday had live samples 11 (09:00) and 12 (15:00) — close must be 12:
  // active 5.1 oz × 12 = 61.2 at the second-to-last series point
  const y = await page.evaluate(() => {
    const d = window.Chart.getChart(document.getElementById("dmHeroChart")).data.datasets[0].data;
    return d[d.length - 2].y;
  });
  expect(Math.abs(y - 61.2)).toBeLessThan(1e-6);
});

test("D-16: footer provenance renders the last-sync surface, no per-sample claims", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  const foot = page.locator("#detailsModal .dm-foot");
  await expect(foot).toContainText(/last sync/i);
  await expect(foot).not.toContainText(/seed/i);
});

// ── AC-16 / AC-17: composition ──────────────────────────────────────────────

test("AC-16/AC-17: two panels, |metric| ranking with +N more, metric toggle re-renders signed Gain/Loss", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "All");
  await chartReady(page);
  const panels = page.locator("#detailsModal .dm-panel:has(.dm-comp-bar)");
  await expect(panels).toHaveCount(2);
  await expect(panels.nth(0).locator(".dm-panel-title")).toContainText(/by metal/i);
  await expect(panels.nth(1).locator(".dm-panel-title")).toContainText(/location/i);
  // 7 active purchase locations seeded → top 6 + a "+N more" row
  await expect(panels.nth(1).locator(".dm-comp-row:not(.dm-comp-more)")).toHaveCount(6);
  await expect(panels.nth(1).locator(".dm-comp-more")).toContainText(/more/);
  await expect(page.locator('#detailsModal [data-metric="melt"]')).toHaveClass(/active/);
  await page.click('#detailsModal [data-metric="gainLoss"]');
  await expect(page.locator('#detailsModal [data-metric="gainLoss"]')).toHaveClass(/active/);
  await expect(
    page.locator("#detailsModal .dm-comp-row .dm-neg, #detailsModal .dm-comp-row .dm-pos").first()
  ).toBeVisible();
});

// ── AC-18 / AC-19: ledger ───────────────────────────────────────────────────

test("AC-18: ledger lists active Items newest-first with undated last; disposed excluded", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  const rows = page.locator("#detailsModal .dm-ledger tbody tr[data-uuid]");
  await expect(rows).toHaveCount(4); // s5(3d), s1(5d), s2(45d), s3(undated) — s4 excluded
  await expect(rows.nth(0)).toHaveAttribute("data-uuid", "s5");
  await expect(rows.nth(1)).toHaveAttribute("data-uuid", "s1");
  await expect(rows.nth(2)).toHaveAttribute("data-uuid", "s2");
  await expect(rows.nth(3)).toHaveAttribute("data-uuid", "s3");
  await expect(rows.nth(3)).toContainText("—"); // undated date cell
});

test("AC-19: ledger row click opens the Item View modal; View-all deep-links #/inventory", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  await page.click('#detailsModal .dm-ledger tbody tr[data-uuid="s1"]');
  await expect(page.locator("#viewItemModal")).toBeVisible();
  await expect(page.locator("#viewItemModal")).toContainText("Big Silver Bar");
  await page.click("#viewItemModal .view-modal-close");
  await page.click("#detailsModal .dm-foot-inventory-link, #detailsModal .dm-link");
  await expect(page).toHaveURL(/#\/inventory$/);
  await expect(page.locator("#detailsModal")).toBeHidden();
});

// ── AC-21: empty and disposed-only states ───────────────────────────────────

test("AC-21: a never-populated scope shows the empty state whose CTA runs the #newItemBtn path", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Palladium");
  const empty = page.locator("#detailsModal .empty-state");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(/no palladium items yet/i);
  await expect(page.locator("#detailsModal #dmHeroChart")).toHaveCount(0);
  await empty.locator(".btn").click();
  await expect(page.locator("#itemModal")).toBeVisible();
});

test("AC-21: the All scope with no Items at all uses the generic empty copy", async ({ page }) => {
  await installSeed(page, { items: [], spotHistory: [] });
  await bootApp(page);
  await openScope(page, "All");
  await expect(page.locator("#detailsModal .empty-state")).toContainText(/no items yet/i);
});

test("AC-21: a disposed-only scope renders history, zeroed holdings, nonzero Realized, and a ledger note", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Platinum");
  await chartReady(page); // history renders — NOT the empty state
  await expect(page.locator("#detailsModal .empty-state")).toHaveCount(0);
  const kpis = page.locator("#detailsModal .dm-kpi");
  await expect(kpis.nth(1).locator(".dm-kpi-value")).toContainText(/0[.,]00/); // melt 0
  await expect(kpis.nth(4).locator(".dm-kpi-value")).toContainText("25"); // realized
  await expect(page.locator("#detailsModal .dm-ledger tbody tr[data-uuid]")).toHaveCount(0);
  await expect(page.locator("#detailsModal .dm-ledger-note")).toBeVisible();
});

// ── AC preamble: active display currency everywhere ─────────────────────────

test("currency: every monetary surface renders via formatCurrency in the active display currency", async ({
  page,
}) => {
  await installSeed(page, {
    extraJson: { displayCurrency: "EUR", exchangeRates: { EUR: 2 } },
  });
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  // KPI purchase: cost 135 USD × rate 2 → €270.00
  await expect(page.locator("#detailsModal .dm-kpi").nth(0).locator(".dm-kpi-value")).toHaveText(
    /€270\.00/
  );
  await expect(page.locator("#detailsModal .dm-substrip")).toContainText("€");
  await expect(page.locator('#detailsModal .dm-ledger tbody tr[data-uuid="s1"]')).toContainText(
    /€100\.00/
  ); // paid 50 × 2
  await expect(page.locator("#detailsModal .dm-comp-row").first()).toContainText("€");
  // chart axis ticks + tooltip amounts converted too
  const tickHasEuro = await page.evaluate(() =>
    window.Chart.getChart(document.getElementById("dmHeroChart")).scales.y.ticks.some((t) =>
      String(t.label).includes("€")
    )
  );
  expect(tickHasEuro).toBe(true);
  const box = await page.locator("#dmHeroChart").boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.5);
  await expect(page.locator("#dmChartTooltip")).toContainText("€");
});

// ── AC-24: keyboard + touch targets ─────────────────────────────────────────

test("AC-24: ledger rows and chips are keyboard-operable with accessible states", async ({
  page,
}) => {
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  const row = page.locator('#detailsModal .dm-ledger tbody tr[data-uuid="s1"]');
  await expect(row).toHaveAttribute("role", "button");
  await expect(row).toHaveAttribute("tabindex", "0");
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#viewItemModal")).toBeVisible();
  await page.click("#viewItemModal .view-modal-close");
  const basisChip = page.locator('#detailsModal .dm-series-chip[data-series="basis"]');
  await basisChip.focus();
  await page.keyboard.press("Space");
  await expect(basisChip).toHaveAttribute("aria-pressed", "false");
});

test("AC-24: interactive controls meet the 44px touch target on mobile viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installSeed(page);
  await bootApp(page);
  await openScope(page, "Silver");
  await chartReady(page);
  for (const sel of [
    "#detailsCloseBtn",
    '#detailsModal [data-range="30D"]',
    '#detailsModal .dm-ledger tbody tr[data-uuid="s1"]',
  ]) {
    const box = await page.locator(sel).boundingBox();
    expect(box.height, `${sel} height`).toBeGreaterThanOrEqual(44);
  }
});

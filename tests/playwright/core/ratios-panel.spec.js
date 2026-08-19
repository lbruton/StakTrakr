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

    // In-panel pair selector: five real buttons (Ag:Cu joined in STRK-341),
    // the active pair pressed.
    const pairButtons = page.locator(`${MOUNT} .gsr-pairs button`);
    await expect(pairButtons).toHaveCount(5);
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
    // The chosen range must survive a pair-switch rerender — the pill follows
    // activeRange rather than resetting to a hard-coded 90D.
    await page.locator(`${MOUNT} [data-pair="au-pd"]`).click();
    await expect(page.locator(`${MOUNT} .gsr-tf button[data-r="max"]`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(pageErrors).toEqual([]);
  });

  test("theme switch repaints the chart via the data-theme observer", async ({ page }) => {
    // The redraw destroys and recreates the Chart.js instance, so a changed
    // instance id is the deterministic signal that the observer actually
    // repainted — not just that the canvas element survived.
    const beforeId = await page.evaluate(() => {
      const canvas = document.querySelector("#ratiosPanelTestMount .gsr-canvas canvas");
      return window.Chart.getChart(canvas)?.id ?? null;
    });
    expect(beforeId).not.toBeNull();
    await page.evaluate(() => {
      const current = document.documentElement.getAttribute("data-theme");
      document.documentElement.setAttribute("data-theme", current === "light" ? "dark" : "light");
    });
    await page.waitForFunction((prev) => {
      const canvas = document.querySelector("#ratiosPanelTestMount .gsr-canvas canvas");
      const instance = window.Chart.getChart(canvas);
      return Boolean(instance) && instance.id !== prev;
    }, beforeId);
    expect(pageErrors).toEqual([]);
  });

  test("destroy() unmounts cleanly", async ({ page }) => {
    await page.evaluate(() => window.__ratiosPanelHandle.destroy());
    await expect(page.locator(`${MOUNT} .gsr-panel`)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});

// =============================================================================
// STRK-271 — spot-card ratio chips open the panel modal (in-app host)
// =============================================================================
test.describe("core/ratios-panel — chip → modal host (STRK-271)", () => {
  const MODAL = "#ratiosPanelModal";

  test.beforeEach(async ({ page }) => {
    await page.goto("/index.html");
    // Chips render from spotPrices (defaults are positive) once the deferred
    // chip script initializes; the silver chip is the canary.
    await page.waitForSelector('.spot-card[data-metal="silver"] .spot-ratio-chip.is-actionable');
  });

  test("exactly the four ratio chips are actionable — never the goldback chip", async ({
    page,
  }) => {
    // Four since STRK-341: Au:Ag, Au:Pt, Au:Pd, plus Ag:Cu on the copper card
    // (in the DOM but hidden with copper's card until the Metal Order opt-in —
    // visibility is covered in core/settings.spec.js).
    await expect(page.locator(".spot-ratio-chip.is-actionable")).toHaveCount(4);
    // The gold card's chip (when present) shows a G1 rate, not a ratio — it
    // must never carry the actionable affordance or a pair mapping.
    await expect(
      page.locator('.spot-card[data-metal="gold"] .spot-ratio-chip.is-actionable')
    ).toHaveCount(0);
    // Actionable chips read as buttons with a visible caret.
    const silverChip = page.locator('.spot-card[data-metal="silver"] .spot-ratio-chip');
    await expect(silverChip).toHaveAttribute("role", "button");
    await expect(silverChip.locator(".caret")).toBeVisible();
  });

  test("clicking a chip opens the modal on the matching pair", async ({ page }) => {
    await page.locator('.spot-card[data-metal="palladium"] .spot-ratio-chip').click();
    await expect(page.locator(MODAL)).toBeVisible();
    await expect(page.locator(`${MODAL} .gsr-panel`)).toHaveAttribute("data-accent", "palladium");
    await expect(page.locator(`${MODAL} [data-pair="au-pd"]`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // The in-panel selector still allows switching without closing.
    await page.locator(`${MODAL} [data-pair="au-ag"]`).click();
    await expect(page.locator(`${MODAL} .gsr-panel`)).toHaveAttribute("data-accent", "silver");
    await expect(page.locator(MODAL)).toBeVisible();
  });

  test("keyboard activation opens the modal; Esc closes and returns focus", async ({ page }) => {
    const chip = page.locator('.spot-card[data-metal="platinum"] .spot-ratio-chip');
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(MODAL)).toBeVisible();
    await expect(page.locator(`${MODAL} [data-pair="au-pt"]`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.keyboard.press("Escape");
    await expect(page.locator(MODAL)).toBeHidden();
    // Focus returns to the originating chip.
    await expect(chip).toBeFocused();
  });

  test("opening the modal dismisses the fixed-position chip tooltip", async ({ page }) => {
    const chip = page.locator('.spot-card[data-metal="silver"] .spot-ratio-chip');
    await chip.hover();
    await expect(page.locator("#chipTip")).toHaveClass(/show/);
    // Tooltip copy carries the new activation hint.
    await expect(page.locator("#chipTip")).toContainText("Click for trends");
    await chip.click();
    await expect(page.locator(MODAL)).toBeVisible();
    // The z-9999 tooltip singleton must not float above the dialog.
    await expect(page.locator("#chipTip")).not.toHaveClass(/show/);
  });

  test("close button tears down the mounted panel", async ({ page }) => {
    await page.locator('.spot-card[data-metal="silver"] .spot-ratio-chip').click();
    await expect(page.locator(MODAL)).toBeVisible();
    await page.locator("#ratiosPanelCloseBtn").click();
    await expect(page.locator(MODAL)).toBeHidden();
    await expect(page.locator("#ratiosPanelMount .gsr-panel")).toHaveCount(0);
  });

  test("backdrop click closes with the same teardown as the close button", async ({ page }) => {
    const chip = page.locator('.spot-card[data-metal="silver"] .spot-ratio-chip');
    await chip.click();
    await expect(page.locator(MODAL)).toBeVisible();
    // Click the backdrop itself (top-left corner is outside .modal-content) —
    // this exercises the host's pre-claimed handler, not openModalById's
    // generic close, so panel teardown and focus return must both run.
    await page.locator(MODAL).click({ position: { x: 5, y: 5 } });
    await expect(page.locator(MODAL)).toBeHidden();
    await expect(page.locator("#ratiosPanelMount .gsr-panel")).toHaveCount(0);
    await expect(chip).toBeFocused();
  });

  test("Space activates a focused chip without scrolling the page", async ({ page }) => {
    const chip = page.locator('.spot-card[data-metal="silver"] .spot-ratio-chip');
    await chip.focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press(" ");
    await expect(page.locator(MODAL)).toBeVisible();
    await expect(page.locator(`${MODAL} [data-pair="au-ag"]`)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // The preventDefault must have suppressed Space's default page scroll.
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });
});

// =============================================================================
// STRK-273 — standalone /ratios/ page (second host, installable PWA)
// =============================================================================
test.describe("core/ratios-panel — standalone /ratios/ page (STRK-273)", () => {
  const PAGE_MOUNT = "#ratiosPageMount";
  // Fresh v2 envelope: generated_at now, within its own stale_after budget.
  const spotFixture = (generatedAt = new Date().toISOString()) => ({
    v: 2,
    generated_at: generatedAt,
    stale_after: 1200,
    data: {
      xau: { price: 4300 },
      xag: { price: 67 },
      xpt: { price: 1600 },
      xpd: { price: 1400 },
    },
  });

  /** Blocks all API-origin traffic, then serves latest.json from the fixture. */
  const routeApi = async (page, fixture) => {
    await page.route("https://api.staktrakr.com/**", (route) => route.abort());
    if (fixture) {
      await page.route("https://api.staktrakr.com/data/v2/spot/latest.json", (route) =>
        route.fulfill({ json: fixture })
      );
    }
  };

  test("renders the panel from the seed bundle with a Live badge when spot is up", async ({
    page,
  }) => {
    await routeApi(page, spotFixture());
    await page.goto("/ratios/");
    await expect(page.locator(`${PAGE_MOUNT} .gsr-panel`)).toBeVisible();
    // Five pair buttons since STRK-341 added Ag:Cu.
    await expect(page.locator(`${PAGE_MOUNT} .gsr-pairs button`)).toHaveCount(5);
    // The live quotes drive the hero: 4300 / 67 ≈ 64.2 at Au:Ag's 1dp.
    await expect(page.locator(`${PAGE_MOUNT} .gsr-hero-num`)).toContainText("64.2");
    await expect(page.locator(`${PAGE_MOUNT} .gsr-live`)).toHaveAttribute("data-state", "live");
  });

  test("a STALE 200 envelope is refused — no Live badge on old cached prices", async ({ page }) => {
    // A CDN/proxy can serve an old envelope with a 200; the page must treat it
    // like a failed fetch instead of stamping stale quotes as live.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await routeApi(page, spotFixture(twoHoursAgo));
    await page.goto("/ratios/");
    await expect(page.locator(`${PAGE_MOUNT} .gsr-panel`)).toBeVisible();
    await expect(page.locator(`${PAGE_MOUNT} .gsr-live`)).toHaveAttribute("data-state", "stale");
    await expect(page.locator(`${PAGE_MOUNT} .gsr-hero-num`)).not.toContainText("64.2");
  });

  test("falls back to the last close with an honest badge when the spot API is down", async ({
    page,
  }) => {
    await page.route("https://api.staktrakr.com/**", (route) => route.abort());
    await page.goto("/ratios/");
    await expect(page.locator(`${PAGE_MOUNT} .gsr-panel`)).toBeVisible();
    await expect(page.locator(`${PAGE_MOUNT} .gsr-live`)).toHaveAttribute("data-state", "stale");
    await expect(page.locator(`${PAGE_MOUNT} .gsr-live`)).toContainText("Last close");
  });

  test("inherits the tracker's saved theme via same-origin localStorage", async ({ page }) => {
    await page.route("https://api.staktrakr.com/**", (route) => route.abort());
    await page.addInitScript(() => localStorage.setItem("appTheme", "sepia"));
    await page.goto("/ratios/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  });

  test("first-time visitors get the dark default and the page writes NO storage", async ({
    page,
  }) => {
    await page.route("https://api.staktrakr.com/**", (route) => route.abort());
    await page.goto("/ratios/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(`${PAGE_MOUNT} .gsr-panel`)).toBeVisible();
    // Zero-user-data promise: no localStorage writes, not even the theme.
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
  });

  test("PWA identity: own scoped manifest, apple-touch icon, out-of-scope tracker link", async ({
    page,
  }) => {
    await page.route("https://api.staktrakr.com/**", (route) => route.abort());
    await page.goto("/ratios/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "./manifest.json");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "../images/ratios-apple-touch-icon.png"
    );
    // Deliberately outside /ratios/ scope — breaks out of the standalone window.
    await expect(page.locator(".ratios-open-tracker")).toHaveAttribute("href", "../");
    const manifest = await page.evaluate(async () => (await fetch("./manifest.json")).json());
    expect(manifest.id).toBe("/ratios/");
    expect(manifest.scope).toBe("/ratios/");
    expect(manifest.start_url).toBe("/ratios/");
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });
});

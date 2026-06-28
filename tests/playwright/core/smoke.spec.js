import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";
import { DEFAULT_RETAIL_LATEST } from "../helpers/mocks/fixtures.js";

async function allowWhatsNew(page) {
  await page.addInitScript(() => {
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      if (key === "ackVersion") return;
      origSetItem(key, value);
    };
  });
}

async function dismissWhatsNew(page) {
  const card = page.locator(".whats-new-toast-card");
  const isVisible = await card.isVisible();
  if (isVisible) {
    await card.locator(".wntc-close").click();
    await expect(card).toBeHidden();
  }
}

test.describe("core/smoke — app shell boot", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  test("page loads at local URL with branding", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page).toHaveTitle(/StakTrakr/);
    await expect(page.locator("#appLogo")).toBeVisible();
  });

  test("What's New toast card appears on first load", async ({ page }) => {
    await allowWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeVisible({ timeout: 5000 });
  });

  test("What's New contains latest patch notes", async ({ page }) => {
    await allowWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeVisible({ timeout: 5000 });
    const versionEl = page.locator(".wntc-version");
    await expect(versionEl).not.toBeEmpty();
  });

  test("clicking dismiss closes the What's New toast card", async ({ page }) => {
    await allowWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeVisible({ timeout: 5000 });
    await page.locator(".wntc-close").click();
    await expect(page.locator(".whats-new-toast-card")).toBeHidden();
  });

  test("What's New does NOT appear on refresh (session-scoped)", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    await page.goto("/index.html");
    await expect(page.locator(".whats-new-toast-card")).toBeHidden();
  });

  test("header displays menu items", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const headerBtns = page.locator("#headerBtnContainer button.header-toggle-btn:visible");
    const count = await headerBtns.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("version number in header matches deployed patch version", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const versionBadge = page.locator("#versionBadgeValue");
    await expect(versionBadge).toBeVisible({ timeout: 5000 });
    const text = await versionBadge.textContent();
    expect(text.trim()).toMatch(/\d+\.\d+\.\d+/);
    expect(text.trim()).not.toMatch(/^0\.0\.0/);
    expect(text.trim()).not.toContain("undefined");
  });

  test("spot cards render (all 4 metals, non-zero values)", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    for (const metal of ["Gold", "Silver", "Platinum", "Palladium"]) {
      const el = page.locator(`#spotPriceDisplay${metal}`);
      await expect(el).toBeVisible();
      await expect(el).not.toHaveText("—", { timeout: 10000 });
      const text = await el.textContent();
      expect(text.trim()).not.toBe("$0.00");
      expect(text.trim()).not.toBe("N/A");
    }
  });

  test("spot API backfills missing spot prices for last 30 days on load", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    for (const metal of ["Gold", "Silver", "Platinum", "Palladium"]) {
      const el = page.locator(`#spotPriceDisplay${metal}`);
      await expect(el).toBeVisible();
      await expect(el).not.toHaveText("—", { timeout: 10000 });
      const text = await el.textContent();
      expect(text.trim()).not.toBe("N/A");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  test("market API backfills daily market prices without errors on load", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const errorToast = page.locator(".cloud-toast", {
      hasText: /storage is full|quota|could not be saved/i,
    });
    await expect(errorToast).toHaveCount(0);
  });

  test("seed inventory count is accurate on first load", async ({ page }) => {
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const countEl = page.locator("#totalItemsAll");
    await expect(countEl).toBeVisible();
    await expect(countEl).toHaveText("8");
  });

  test("fresh startup stays quota-safe and keeps market UI available", async ({ page }) => {
    await page.addInitScript((retailLatest) => {
      window._v2RetailData = {
        prices: retailLatest,
        lastSync: new Date().toISOString(),
      };
    }, DEFAULT_RETAIL_LATEST);
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    const quotaToast = page.locator(".cloud-toast", {
      hasText: /storage is full|quota|spot history|could not be saved/i,
    });
    await expect(quotaToast).toHaveCount(0);
    const ticker = page.locator("#bestPriceTickerEl");
    await expect(ticker).toBeVisible();
  });
});

// ===========================================================================
// STRK-161 — Spot card ratio chips
// Exercises the live renderRatioChips() path: DOM structure + interaction
// (not bare "text exists" — STRK-123 lesson).
// ===========================================================================
test.describe("core/STRK-161 — spot card ratio chips", () => {
  // Card metals as they appear in the markup (id suffix = TitleCase metal name).
  const RATIO_CARDS = [
    { metal: "Silver", label: "Au:Ag" },
    { metal: "Platinum", label: "Au:Pt" },
    { metal: "Palladium", label: "Au:Pd" },
  ];

  const card = (page, metal) => page.locator(`.spot-card[data-metal="${metal.toLowerCase()}"]`);
  const chip = (page, metal) => card(page, metal).locator(".spot-ratio-chip");

  async function bootDashboard(page) {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    // Wait until spot prices have settled to real values so the ratio math has inputs.
    for (const metal of ["Gold", "Silver", "Platinum", "Palladium"]) {
      const el = page.locator(`#spotPriceDisplay${metal}`);
      await expect(el).not.toHaveText("—", { timeout: 10000 });
      await expect(el).not.toHaveText("$0.00", { timeout: 10000 });
    }
  }

  test("AC-1: silver/platinum/palladium cards each render a ratio chip with the right label + numeric value", async ({
    page,
  }) => {
    await bootDashboard(page);
    for (const { metal, label } of RATIO_CARDS) {
      const c = chip(page, metal);
      await expect(c).toHaveCount(1);
      await expect(c.locator(".lab")).toHaveText(label);
      // Value is a finite number (no Infinity/NaN), to the chip's decimal precision.
      await expect(c.locator(".val")).toHaveText(/^\d[\d,]*(\.\d+)?$/);
    }
  });

  test("AC-1: gold card renders the goldback chip (GB $...) with a currency-formatted value", async ({
    page,
  }) => {
    await bootDashboard(page);
    const c = chip(page, "Gold");
    await expect(c).toHaveCount(1);
    await expect(c.locator(".lab")).toHaveText("GB");
    await expect(c.locator(".val")).toHaveText(/^\$\d[\d,]*\.\d{2}$/);
  });

  // =========================================================================
  // STRK-249 — AC-4 / AC-5: gold-card GB chip repaints after the async
  // goldback API fetch resolves, on a NORMAL (non-hard-refresh) load.
  //
  // Both paths are implemented and GREEN (C.3 shipped in this PR):
  //   AC-4 (success): fetchGoldbackApiPrices() calls _repaintGoldbackRatioChips()
  //     after seeding goldbackPrices['1'], so the GB chip is present synchronously
  //     at the moment the fetch promise resolves.
  //   AC-5 (failure regression guard): all failure/empty early-return paths exit
  //     before the repaint call, so a failed fetch leaves a previously-painted chip
  //     untouched — the chip neither blanks out nor throws.
  //
  // These assert via DOM STRUCTURE (the .spot-card[data-metal="gold"]
  // .spot-ratio-chip element + its .lab/.val children), not "text exists".
  // =========================================================================

  // Boot the dashboard in goldback "api" mode while the goldback endpoint FAILS,
  // so the fire-and-forget boot fetch (init.js ~:634-641) leaves goldbackPrices['1']
  // empty and the gold card paints NO GB chip. The caller then controls the next
  // fetch via the success/fail route below.
  async function bootGoldbackApiMode(page, { goldbackFails }) {
    await injectSeedInventory(page);
    await page.addInitScript(() =>
      localStorage.setItem("goldback-pricing-source", JSON.stringify("api"))
    );
    await routeGoldbackLatest(page, { fails: goldbackFails });
    await page.goto("/index.html");
    await dismissWhatsNew(page);
    // Wait for gold spot to settle so the chip's eligibility depends only on the
    // goldback cache, not on missing spot inputs.
    await expect(page.locator("#spotPriceDisplayGold")).not.toHaveText("—", { timeout: 10000 });
  }

  // Override the goldback endpoints on BOTH v2 hosts to keep AC-4 / AC-5 hermetic.
  // latest.json: a 503 leaves the goldback cache untouched; a 200 returns a fresh
  //   G1 envelope (ts=now, stale_after generous) so resolveGoldbackRate() yields a
  //   fresh, non-estimate rate.
  // history-30d.json: fetchGoldbackApiPrices() calls fetchGoldbackApiHistory() with
  //   the resolved endpoint after a successful latest.json fetch, which would hit the
  //   LIVE history URL and make AC-4 / AC-5 CI-flaky. Stub it with an empty-but-valid
  //   payload so no live network request escapes the test boundary.
  async function routeGoldbackLatest(page, { fails }) {
    const latestHandler = async (route) => {
      if (fails) {
        await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          v: 2,
          generated_at: new Date().toISOString(),
          data: { g1_usd: 4.25, ts: Math.floor(Date.now() / 1000) },
          stale_after: 90000,
        }),
      });
    };
    const historyHandler = async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ v: 2, generated_at: new Date().toISOString(), data: [] }),
      });
    };
    await page.route("https://api.staktrakr.com/data/v2/goldback/latest.json", latestHandler);
    await page.route("https://api2.staktrakr.com/data/v2/goldback/latest.json", latestHandler);
    await page.route("https://api.staktrakr.com/data/v2/goldback/history-30d.json", historyHandler);
    await page.route(
      "https://api2.staktrakr.com/data/v2/goldback/history-30d.json",
      historyHandler
    );
  }

  // Spy on the render choke point so we can prove the goldback FETCH itself drives
  // the repaint, with a snapshot taken synchronously the instant the fetch resolves.
  // (Stray boot spot-sync timers also call renderRatioChips(), so a polled toHaveCount
  // would be rescued by an unrelated repaint and mask the C.3 gap — the snapshot fence
  // captures the exact post-fetch state before any later timer can run.)
  async function installRenderSpy(page) {
    await page.evaluate(() => {
      const orig = window.renderRatioChips;
      window.__rrcCalls = 0;
      window.renderRatioChips = function (...args) {
        window.__rrcCalls += 1;
        return orig.apply(this, args);
      };
    });
  }

  test("AC-4: fetchGoldbackApiPrices() repaints the gold-card GB chip when it resolves (normal load)", async ({
    page,
  }) => {
    // Boot with the goldback fetch failing: the cache is empty → no GB chip yet.
    await bootGoldbackApiMode(page, { goldbackFails: true });
    await installRenderSpy(page);

    // Let the goldback endpoint succeed and drive the production async fetch. It
    // seeds a fresh goldbackPrices['1'] (so resolveGoldbackRate() yields a chip),
    // then a correct implementation repaints. Snapshot the chip + render-call delta
    // the instant the fetch resolves — before any stray spot-sync timer can repaint.
    await routeGoldbackLatest(page, { fails: false });
    const snap = await page.evaluate(async () => {
      const before = window.__rrcCalls;
      const result = await window.fetchGoldbackApiPrices({ expectedSource: "api" });
      return {
        ok: result.ok,
        repainted: window.__rrcCalls > before, // did the fetch itself call renderRatioChips()?
        chipPresent: !!document.querySelector('.spot-card[data-metal="gold"] .spot-ratio-chip'),
      };
    });

    expect(snap.ok).toBe(true);
    // RED: fetchGoldbackApiPrices() never calls renderRatioChips() (C.3 gap), so the
    // fetch did not repaint and the freshly-cached GB chip is absent at resolve time.
    expect(snap.repainted).toBe(true);
    expect(snap.chipPresent).toBe(true);
  });

  // AC-5 = REGRESSION GUARD (green-by-construction, before AND after C.3).
  // The approved C.3 design adds renderRatioChips() ONLY in the success block of
  // fetchGoldbackApiPrices (js/goldback.js after :484, before the {ok:true} return
  // at :486). Every failure/empty path early-returns {ok:false} BEFORE that block
  // (:449, :453, :456, :460), so a FAILING fetch is a guarded skip — it never
  // repaints. A previously-painted GB chip must therefore survive a failed fetch
  // untouched (no throw, no blank-out). This test catches a wrong C.3 that repaints
  // unconditionally and blanks/recomputes the chip on failure. It is NOT a RED test.
  test("AC-5: a failed/empty goldback fetch leaves the previously-rendered GB chip untouched (no throw, no blank-out)", async ({
    page,
  }) => {
    // Boot with the goldback fetch succeeding so a fresh GB chip is painted + cached.
    await bootGoldbackApiMode(page, { goldbackFails: false });
    const c = chip(page, "Gold");
    await expect(c).toHaveCount(1);
    const paintedValue = await c.locator(".val").textContent();

    // Drive a FAILING goldback fetch (the cache stays fresh; HTTP error → {ok:false}).
    // The chip is left in place — the guarded-skip design must not disturb it.
    await routeGoldbackLatest(page, { fails: true });
    const result = await page.evaluate(async () =>
      // Must resolve cleanly (no throw) even though the fetch fails.
      window.fetchGoldbackApiPrices({ expectedSource: "api" })
    );
    expect(result.ok).toBe(false);

    // The previously-rendered chip is still present and unchanged (not blanked out).
    const after = chip(page, "Gold");
    await expect(after).toHaveCount(1);
    await expect(after.locator(".lab")).toHaveText("GB");
    await expect(after.locator(".val")).toHaveText(paintedValue);
  });

  test("own-row contract: chip is a sibling AFTER .spot-card-change and BEFORE .spot-card-timestamp", async ({
    page,
  }) => {
    await bootDashboard(page);
    for (const { metal } of [...RATIO_CARDS, { metal: "Gold" }]) {
      // The chip's order index within the card must fall between the change row and timestamp row.
      const order = await card(page, metal).evaluate((cardEl) => {
        const kids = Array.from(cardEl.children);
        const idx = (sel) => kids.findIndex((k) => k.matches(sel));
        return {
          change: idx(".spot-card-change"),
          chip: idx(".spot-ratio-chip"),
          timestamp: idx(".spot-card-timestamp"),
        };
      });
      expect(order.chip).toBeGreaterThan(order.change);
      expect(order.chip).toBeLessThan(order.timestamp);
    }
  });

  test("AC-3: ratio chip is absent when that card's spot price is ≤ 0 (never Infinity/NaN)", async ({
    page,
  }) => {
    await bootDashboard(page);
    // Force silver spot to 0 via the same path the app uses on load, then re-render.
    await page.evaluate(() => {
      localStorage.setItem("spotSilver", "0");
      window.fetchSpotPrice();
      window.renderRatioChips();
    });
    await expect(chip(page, "Silver")).toHaveCount(0);
    // The other ratio chips remain.
    await expect(chip(page, "Platinum")).toHaveCount(1);
    await expect(chip(page, "Palladium")).toHaveCount(1);
    // And no chip ever leaks Infinity/NaN.
    await expect(page.locator(".spot-ratio-chip .val", { hasText: /Infinity|NaN/ })).toHaveCount(0);
  });

  test("AC-8: ratio chip re-renders after a manual (shift+click) spot edit", async ({ page }) => {
    await bootDashboard(page);
    const valEl = chip(page, "Silver").locator(".val");
    const before = await valEl.textContent();

    // Drive the production manual-edit path: open the inline editor via the exposed
    // startSpotInlineEdit (the shift+click coordinate gesture is flaky under Playwright;
    // verified in-browser that the shift+click handler calls this same function), then save.
    await page.evaluate(() => {
      const el = document.getElementById("spotPriceDisplaySilver");
      window.startSpotInlineEdit(el, "silver");
      const input = el.querySelector(".spot-inline-input");
      input.value = "12.5";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    // The silver ratio chip must reflect the new spot (gold ÷ 12.5 differs from before).
    await expect(valEl).not.toHaveText(before);
  });

  test("AC-8: ratio chips re-render after an API sync", async ({ page }) => {
    await bootDashboard(page);
    const valEl = chip(page, "Silver").locator(".val");
    const before = await valEl.textContent();

    // Drive the sync path; the implementation must re-render chips at its tail.
    await page.evaluate(() => {
      localStorage.setItem("spotSilver", "40");
      window.fetchSpotPrice();
      return window.syncAllProviders && window.syncAllProviders();
    });

    await expect(valEl).not.toHaveText(before);
  });

  test("AC-9: gold (goldback) chip re-renders after a goldback refresh", async ({ page }) => {
    // Goldback "spot" mode derives the G1 rate from gold spot, so a gold-spot change
    // refreshes the rate. (In "api" mode the chip reflects the hourly scrape cache and
    // is correctly unaffected by gold spot — the wrong mode to assert a live change in.)
    await page.addInitScript(() =>
      localStorage.setItem("goldback-pricing-source", JSON.stringify("spot"))
    );
    await bootDashboard(page);
    const valEl = chip(page, "Gold").locator(".val");
    await expect(valEl).toHaveCount(1);
    const before = await valEl.textContent();

    // Refresh the goldback rate by changing gold spot, then firing the refresh hook
    // (C.3 wires renderRatioChips() into onGoldSpotPriceChanged's spot-mode recompute).
    await page.evaluate(() => {
      if (typeof spotPrices !== "undefined") spotPrices.gold = 9999;
      if (typeof window.onGoldSpotPriceChanged === "function") window.onGoldSpotPriceChanged();
    });

    await expect(valEl).not.toHaveText(before);
  });

  test("AC-13: chip is keyboard-focusable and reveals a body-appended fixed tooltip on focus", async ({
    page,
  }) => {
    await bootDashboard(page);
    const c = chip(page, "Silver");
    await expect(c).toHaveAttribute("tabindex", "0");

    await c.focus();

    const tip = page.locator("#chipTip");
    // Tooltip is a singleton appended to <body>, NOT a descendant of any spot card.
    await expect(tip).toHaveCount(1);
    await expect(page.locator(".spot-card #chipTip")).toHaveCount(0);
    await expect(tip).toHaveCSS("position", "fixed");
    await expect(tip).toBeVisible();
  });

  test("AC-13: chip reveals the tooltip on pointer hover", async ({ page }) => {
    await bootDashboard(page);
    const c = chip(page, "Platinum");

    await c.hover();

    const tip = page.locator("#chipTip");
    await expect(tip).toHaveCSS("position", "fixed");
    await expect(tip).toBeVisible();
  });
});

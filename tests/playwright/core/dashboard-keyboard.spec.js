// Every Dashboard action works from the keyboard, and assistive tech gets headings,
// names and a ticker that lists each dealer price once.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

/** Boots the Dashboard with the seed inventory and a settled best-price ticker. */
async function gotoDashboard(page) {
  await injectSeedInventory(page);
  await page.goto("/index.html");
  await expect(page.locator("#bestPriceTickerEl .ticker-track")).toHaveCount(1);
}

/**
 * Copies each retail coin under two extra slugs and re-renders the ticker, so it holds
 * enough items to animate and build its loop copy.
 */
async function renderLoopingTicker(page) {
  await page.evaluate(() => {
    const coins = _getRetailCoins();
    for (const slug of Object.keys(coins)) {
      coins[`${slug}-a`] = coins[slug];
      coins[`${slug}-b`] = coins[slug];
    }
    window._v2RetailData = { prices: coins };
    document.getElementById("bestPriceTickerEl").dataset.tickerSignature = "";
    renderBestPriceTicker();
  });
  await expect(page.locator("#bestPriceTickerEl .ticker-track")).toHaveCount(1);
  await expect(page.locator("#bestPriceTickerEl [data-ticker-block='duplicate']")).toHaveCount(1);
}

test.describe("Dashboard keyboard and screen reader access", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
  });

  test("the tab order reaches the spot edit buttons, totals titles and ticker dealers", async ({
    page,
  }) => {
    const order = [];
    await page.locator("#tabBtnDashboard").focus();
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || !el.closest("#tabViewDashboard")) return null;
        return {
          id: el.id,
          tag: el.tagName,
          inTitle: !!el.closest(".total-title"),
          inTicker: !!el.closest(".ticker-item"),
          inDuplicate: !!el.closest("[data-ticker-block='duplicate']"),
        };
      });
      if (stop) order.push(stop);
    }
    expect(order.map((s) => s.id)).toContain("spotEditSilver");
    expect(order.filter((s) => s.inTitle && s.tag === "BUTTON").length).toBeGreaterThanOrEqual(4);
    expect(order.some((s) => s.inTicker && s.tag === "BUTTON")).toBe(true);
    expect(order.filter((s) => s.inDuplicate)).toEqual([]);
  });

  test("Enter on a totals title opens that metal's details modal", async ({ page }) => {
    const titles = page.locator("#tabViewDashboard h3.total-title > button");
    await expect(titles.first()).toBeVisible();
    expect(await titles.count()).toBeGreaterThanOrEqual(4);
    const silver = page.locator(".total-title[data-metal='Silver'] > button");
    await silver.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#detailsModal")).toBeVisible();
    await expect(page.locator("#detailsModal")).toContainText("Silver");
  });

  test("ticker dealers are buttons in a named region, listed once", async ({ page }) => {
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (url) => {
        window.__opened.push(url);
        return null;
      };
    });
    const region = page.getByRole("region", { name: "Best dealer prices" });
    await expect(region).toBeVisible();
    await renderLoopingTicker(page);
    const duplicate = page.locator("#bestPriceTickerEl [data-ticker-block='duplicate']");
    await expect(duplicate).toHaveAttribute("aria-hidden", "true");
    expect(
      await duplicate.locator("button").evaluateAll((buttons) => buttons.map((b) => b.tabIndex))
    ).not.toContain(0);
    const dealer = page
      .locator("#bestPriceTickerEl [data-ticker-block='primary'] button.ticker-item")
      .first();
    await dealer.focus();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.__opened.length)).toBe(1);
  });

  test("a visible dealer in the loop copy still opens on a mouse click", async ({ page }) => {
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (url) => {
        window.__opened.push(url);
        return null;
      };
    });
    await renderLoopingTicker(page);
    // Hold the running animation near the loop point, where the copy fills the strip. Only
    // the play state and delay are set, so the app's own focus rules still apply.
    await page.evaluate(() => {
      const track = document.querySelector("#bestPriceTickerEl .ticker-track");
      const duration = parseFloat(getComputedStyle(track).animationDuration);
      track.style.animationDelay = `-${duration * 0.97}s`;
      track.style.animationPlayState = "paused";
    });
    const box = await page
      .locator("#bestPriceTickerEl [data-ticker-block='duplicate'] button.ticker-item")
      .evaluateAll((buttons) => {
        const strip = document.getElementById("bestPriceTickerEl").getBoundingClientRect();
        const visible = buttons
          .map((b) => b.getBoundingClientRect())
          .find((r) => r.left >= strip.left + 80 && r.right <= strip.right - 80);
        return (
          visible && { x: visible.x, y: visible.y, width: visible.width, height: visible.height }
        );
      });
    expect(box, "a copy dealer is inside the strip").toBeTruthy();
    // Press and release separately: a button that moves on pointer focus misses the release.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__opened.length)).toBe(1);
  });

  test("a focused dealer is scrolled into view, and the strip resets when focus leaves", async ({
    page,
  }) => {
    await renderLoopingTicker(page);
    const first = page
      .locator("#bestPriceTickerEl [data-ticker-block='primary'] button.ticker-item")
      .first();
    // Jump the loop near its end, so the first dealer sits off the left edge.
    await page.evaluate(() => {
      const track = document.querySelector("#bestPriceTickerEl .ticker-track");
      const duration = parseFloat(getComputedStyle(track).animationDuration);
      track.style.animationDelay = `-${duration * 0.9}s`;
    });
    const inView = () =>
      first.evaluate((button) => {
        const strip = document.getElementById("bestPriceTickerEl").getBoundingClientRect();
        const box = button.getBoundingClientRect();
        return box.left >= strip.left - 1 && box.right <= strip.right + 1;
      });
    await expect.poll(inView).toBe(false);
    // A key press sets keyboard modality, so the focus below counts as :focus-visible.
    await page.keyboard.press("Shift");
    await first.focus();
    await expect.poll(inView).toBe(true);
    await page.locator(".total-title[data-metal='Silver'] > button").focus();
    await expect
      .poll(() => page.locator("#bestPriceTickerEl").evaluate((strip) => strip.scrollLeft))
      .toBe(0);
  });

  test("cancelling an edit shows the price a background refresh saved meanwhile", async ({
    page,
  }) => {
    await page.locator("#spotEditSilver").click();
    const input = page.locator("#spotPriceDisplaySilver .spot-inline-input");
    await expect(input).toBeFocused();
    await page.evaluate(() =>
      _applyFetchedSpotPrices({ silver: 77.77 }, "STAKTRAKR", new Date().toISOString())
    );
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("$77.77");
  });

  test("tabbing out of an open edit restores the price and keeps the next focus", async ({
    page,
  }) => {
    const edit = page.locator("#spotEditSilver");
    await edit.click();
    const input = page.locator("#spotPriceDisplaySilver .spot-inline-input");
    await expect(input).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(input).toHaveCount(0);
    await expect(edit).not.toBeFocused();
    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("$25.00");
  });

  test("a stored-price reload leaves an open edit in place", async ({ page }) => {
    await page.locator("#spotEditSilver").click();
    const input = page.locator("#spotPriceDisplaySilver .spot-inline-input");
    await expect(input).toBeFocused();
    await page.evaluate(() => window.fetchSpotPrice());
    await expect(input).toHaveCount(1);
  });

  test("the edit button sets a manual spot price and returns focus to itself", async ({ page }) => {
    const edit = page.locator("#spotEditSilver");
    await expect(edit).toHaveAccessibleName("Edit silver spot price");
    await edit.focus();
    await page.keyboard.press("Enter");
    const input = page.locator("#spotPriceDisplaySilver .spot-inline-input");
    await expect(input).toBeFocused();
    await input.fill("99.99");
    await page.keyboard.press("Enter");
    await expect(page.locator("#spotPriceDisplaySilver")).toContainText("$99.99");
    await expect(edit).toBeFocused();
  });

  test("the Dashboard has a heading for each section and each totals card", async ({ page }) => {
    const panel = page.locator("#tabViewDashboard");
    for (const name of ["Spot prices", "Best dealer prices", "Totals"]) {
      await expect(panel.getByRole("heading", { level: 2, name })).toHaveCount(1);
    }
    await expect(panel.getByRole("heading", { level: 3, name: "Silver" })).toHaveCount(1);
  });

  test("ratio chips and refresh buttons name their value and freshness", async ({ page }) => {
    await expect(page.locator(".spot-ratio-chip.metal-silver")).toHaveAccessibleName(
      /^Gold-to-Silver Ratio \(GSR\): [\d.]+$/
    );
    await expect(page.locator("#syncIconSilver")).toHaveAccessibleName(
      /\. Silver prices are (fresh|stale|expired)\.$/
    );
  });
});

test.describe("totals carousel dots", () => {
  test("the active dot follows the scroll position after the metal order changes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDashboard(page);
    await page.evaluate(() => window.refreshTotalsDots());
    const dots = page.locator("#totalsDots .totals-dot");
    await expect(dots.first()).toHaveAttribute("aria-current", "true");
    await page.evaluate(() => {
      const carousel = document.getElementById("totalsCarousel");
      const cards = [...carousel.querySelectorAll(".total-card")]
        .filter((c) => c.style.display !== "none")
        .sort((a, b) => a.offsetLeft - b.offsetLeft);
      carousel.scrollTo({ left: cards[1].offsetLeft, behavior: "instant" });
    });
    await expect(dots.nth(1)).toHaveClass(/\bactive\b/);
    await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(dots.first()).not.toHaveAttribute("aria-current", "true");
  });
});

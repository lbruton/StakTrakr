import { test, expect } from "../helpers/mocks/extended-test.js";

const THEMES = ["light", "dark", "slate", "sepia"];
const REQUIRED_TOKENS = ["--text-inverse", "--tag-bg", "--brand-gold", "--focus-ring"];

async function setTheme(page, theme) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}

test.describe("extended/visual-layout-regressions", () => {
  test("about page keeps its primary static structure and external links", async ({ page }) => {
    await page.goto("/about.html");

    await expect(page).toHaveTitle("StakTrakr — Track Your Precious Metals Stack");
    await expect(page.locator("header.hero")).toBeVisible();
    await expect(page.locator(".hero-logo")).toContainText("StakTrakr");
    await expect(page.locator(".hero-buttons a.btn-primary")).toHaveAttribute(
      "href",
      /staktrakr\.com/
    );
    await expect(page.locator(".hero-buttons a.btn-outline")).toHaveAttribute(
      "href",
      /github\.com\/lbruton\/StakTrakr/
    );
    await expect(page.locator(".pillar")).toHaveCount(4);
    expect(await page.locator(".api-table tbody tr").count()).toBeGreaterThan(2);
    await expect(page.locator("footer a")).toHaveCount(5);
  });

  test("log/changelog tabs retain renamed labels and order", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.showSettingsModal === "function");
    await page.evaluate(() => window.showSettingsModal("changelog"));

    const tabs = page.locator("#settingsPanel_changelog [data-log-tab]");
    const labels = (await tabs.allTextContents()).map((label) => label.trim()).filter(Boolean);
    expect(labels).toEqual([
      "Changelog",
      "Catalogs",
      "Cloud",
      "Spot Price",
      "Market",
      "Item History",
      "LBMA History",
    ]);
  });

  test("font and theme tokens resolve across all supported themes", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const bodyFont = await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily);
    expect(bodyFont).toMatch(/Geist/i);
    const mono = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-mono")
    );
    expect(mono).toMatch(/Geist Mono/i);

    for (const theme of THEMES) {
      await setTheme(page, theme);
      const resolved = await page.evaluate((tokens) => {
        const styles = getComputedStyle(document.documentElement);
        return tokens.map((token) => styles.getPropertyValue(token).trim());
      }, REQUIRED_TOKENS);
      expect(resolved.every(Boolean)).toBe(true);
    }
  });

  test("modal content panels and headers use theme tokens rather than hard-coded slate colors", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.showSettingsModal?.("site"));
    await expect(page.locator("#settingsModal")).toBeVisible();

    const tokenUsage = await page.evaluate(() => {
      const matches = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch (_e) {
          continue;
        }
        for (const rule of Array.from(rules || [])) {
          if (!(rule instanceof CSSStyleRule)) continue;
          if (/modal/i.test(rule.selectorText) && /var\(--/.test(rule.cssText)) {
            matches.push(rule.cssText);
          }
        }
      }
      return matches;
    });
    expect(tokenUsage.length).toBeGreaterThan(5);
    expect(tokenUsage.join("\n")).not.toMatch(/rgba\(15,\s*23,\s*42/i);
  });

  // ── STRK-161 — spot card ratio chips: four-theme legibility + mobile layout ──

  async function waitForSpotChips(page) {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page
      .locator(".whats-new-toast-card .wntc-close")
      .click({ timeout: 5000 })
      .catch(() => {});
    // The chips render off the spot-price write paths, which populate on boot.
    await expect(page.locator(".spot-card .spot-ratio-chip").first()).toBeVisible({
      timeout: 15000,
    });
  }

  test("STRK-161 spot ratio chips resolve a legible token color in all four themes", async ({
    page,
  }) => {
    await waitForSpotChips(page);

    for (const theme of THEMES) {
      await setTheme(page, theme);

      const chips = page.locator(".spot-card .spot-ratio-chip");
      const count = await chips.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const color = await chips.nth(i).evaluate((el) => getComputedStyle(el).color);
        // A resolved, token-derived color — never transparent / zero-alpha, never empty.
        expect(color).toBeTruthy();
        expect(color).not.toBe("transparent");
        expect(color).not.toMatch(/rgba?\([^)]*,\s*0\s*\)$/);
        expect(color).not.toMatch(/\/\s*0\s*\)$/);
        expect(color).toMatch(/^(rgb|oklch|color)\b/i);
      }
    }
  });

  test("STRK-161 chip stays inside its card and timestamp uses the short Last Synced form on mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await waitForSpotChips(page);

    // Cards reflow to a 2×2 stack below the 960px breakpoint.
    const cards = page.locator(".spot-card");
    const cardCount = await cards.count();
    expect(cardCount).toBe(4);

    for (let i = 0; i < cardCount; i++) {
      const card = cards.nth(i);
      const chip = card.locator(".spot-ratio-chip");
      if ((await chip.count()) === 0) continue;

      const fits = await card.evaluate((cardEl) => {
        const chipEl = cardEl.querySelector(".spot-ratio-chip");
        const c = cardEl.getBoundingClientRect();
        const k = chipEl.getBoundingClientRect();
        return k.left >= c.left - 0.5 && k.right <= c.right + 0.5;
      });
      expect(fits).toBe(true);
    }

    // D-9: below 960px the provider span is hidden and the label shows the short "Last Synced" form.
    const timestamp = page.locator(".spot-card .spot-card-timestamp").first();
    await expect(timestamp).toContainText("Last Synced");
    await expect(timestamp).not.toContainText("Last API Sync");

    const providerHidden = await timestamp.evaluate((el) => {
      const provider = el.querySelector(".ts-provider");
      if (!provider) return false;
      return getComputedStyle(provider).display === "none";
    });
    expect(providerHidden).toBe(true);
  });
});

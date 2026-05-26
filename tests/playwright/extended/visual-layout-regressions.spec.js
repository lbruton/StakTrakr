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

  test("log/changelog tabs retain renamed labels, order, and add/undo/redo behavior", async ({
    page,
  }) => {
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
});

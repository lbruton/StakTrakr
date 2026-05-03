import { test, expect } from "@playwright/test";

test.describe("font-loading", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("FL-1 — Geist font loads", async ({ page }) => {
    const geistLoaded = await page.evaluate(() => document.fonts.check('16px "Geist"'));
    expect(geistLoaded).toBe(true);
  });

  test("FL-2 — body uses Geist", async ({ page }) => {
    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(fontFamily).toContain("Geist");
  });

  test("FL-3 — headings use Instrument Serif", async ({ page }) => {
    const fontFamily = await page.evaluate(() => {
      const el = document.querySelector(".section-title");
      return el ? getComputedStyle(el).fontFamily : "";
    });
    expect(fontFamily).toContain("Instrument Serif");
  });

  test("FL-4 — no Inter as primary font", async ({ page }) => {
    const hasInterPrimary = await page.evaluate(() => {
      const elements = document.querySelectorAll("*");
      for (const el of elements) {
        const fontFamily = getComputedStyle(el).fontFamily;
        if (!fontFamily) continue;
        const primary = fontFamily.split(",")[0].trim().replace(/['"]/g, "");
        if (primary === "Inter") return true;
      }
      return false;
    });
    expect(hasInterPrimary).toBe(false);
  });

  test.describe("FL-5 — fonts available offline", () => {
    test.use({ serviceWorkers: "allow" });

    test("Geist loads after going offline", async ({ page, context }) => {
      // First load with service worker registration
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Wait for service worker to be activated
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration("/");
        if (reg && reg.installing) {
          await new Promise((resolve) => {
            reg.installing.addEventListener("statechange", function handler(e) {
              if (e.target.state === "activated") {
                reg.installing?.removeEventListener("statechange", handler);
                resolve();
              }
            });
          });
        }
        if (reg && reg.waiting) {
          await new Promise((resolve) => {
            reg.waiting.addEventListener("statechange", function handler(e) {
              if (e.target.state === "activated") {
                reg.waiting?.removeEventListener("statechange", handler);
                resolve();
              }
            });
          });
        }
      });

      // Go offline by aborting all network requests
      await context.route("**/*", (route) => route.abort());

      // Reload and verify fonts still load
      await page.reload();
      await page.waitForLoadState("domcontentloaded");

      const geistLoaded = await page.evaluate(() => document.fonts.check('16px "Geist"'));
      expect(geistLoaded).toBe(true);
    });
  });

  test("FL-6 — font consistent across themes", async ({ page }) => {
    const themes = ["light", "dark", "sepia"];
    const fontFamilies = [];

    for (const theme of themes) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      fontFamilies.push(fontFamily);
      expect(fontFamily).toContain("Geist");
    }

    // All themes should have the same body font-family
    expect(fontFamilies[0]).toBe(fontFamilies[1]);
    expect(fontFamilies[1]).toBe(fontFamilies[2]);
  });
});

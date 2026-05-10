import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "../helpers/seed.js";

test.describe("STRK-65 — Storage diagnostics clarity", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.attachmentManager !== "undefined");
  });

  test("settings footer labels localStorage with ~5 MB (not implying origin total)", async ({
    page,
  }) => {
    await page.evaluate(async () => {
      if (typeof updateSettingsFooter === "function") await updateSettingsFooter();
    });
    await page.waitForFunction(() => {
      const el = document.getElementById("settingsFooter");
      const text = el ? el.textContent || "" : "";
      return text.includes("~5 MB") && !/LS:.*\/ 5 MB/.test(text);
    });
    const footerText = await page.evaluate(() => {
      const el = document.getElementById("settingsFooter");
      return el ? el.textContent : "";
    });
    expect(footerText).toContain("~5 MB");
    expect(footerText).not.toMatch(/LS:.*\/ 5 MB/);
  });

  test("storage diagnostics combined card says browser quota varies", async ({ page }) => {
    const cardText = await page.evaluate(async () => {
      if (typeof renderStorageSection === "function") await renderStorageSection(true);
      const sub = document.getElementById("storageStat_combined_sub");
      return sub ? sub.textContent : "";
    });
    expect(cardText).toContain("browser quota varies");
  });
});

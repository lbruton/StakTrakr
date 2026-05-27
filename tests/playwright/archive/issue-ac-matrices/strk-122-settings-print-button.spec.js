import { test, expect } from "../../helpers/mocks/extended-test.js";

const SEED_ITEM = {
  uuid: "strk49-test-item-1",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-49 Test Coin",
  qty: 1,
  type: "Coin",
  weight: 1,
  price: 30,
  marketValue: 0,
  date: "2025-01-01",
  purchaseLocation: "staktrakr.com",
  storageLocation: "",
  serialNumber: "",
  notes: "",
  year: "2025",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 28,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
};

async function seedAndLoad(page) {
  await page.addInitScript((item) => {
    localStorage.setItem("metalInventory", JSON.stringify([item]));
    localStorage.setItem("itemTags", JSON.stringify({}));
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") {
          localStorage.setItem("ackVersion", APP_VERSION);
        }
      },
      { once: true }
    );
  }, SEED_ITEM);

  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.showSettingsModal === "function" &&
      typeof window.switchSettingsSection === "function"
  );
  // Phase 14 (event listeners including #printBtn/#exportPdfBtn) fires in a
  // 200 ms setTimeout after DOMContentLoaded. Wait long enough for it to
  // complete before any test clicks those buttons.
  await page.waitForTimeout(300); // let deferred setupEventListeners fire
}

async function openSystemPanel(page) {
  await page.evaluate(() => window.showSettingsModal());
  await expect(page.locator("#settingsModal")).toBeVisible();
  await page.evaluate(() => window.switchSettingsSection("system"));
  await expect(page.locator("#settingsPanel_system")).toBeVisible();
}

test.describe("STRK-49 — Print button, ZIP relocation, Data Reset sizing", () => {
  // ==========================================================================
  // Test 1 — Print button presence and attributes
  // ==========================================================================
  test("1. Print button is in Export card with correct attributes", async ({ page }) => {
    await seedAndLoad(page);
    await openSystemPanel(page);

    const panel = page.locator("#settingsPanel_system");
    const btn = panel.locator("#printBtn");

    await expect(btn).toBeVisible();
    await expect(btn).toHaveClass(/btn success/);
    await expect(btn).toHaveAttribute("aria-describedby", "printDesc");

    const desc = panel.locator("#printDesc");
    await expect(desc).toHaveText("Direct browser print of your full inventory");
    await expect(desc).toHaveClass(/sr-only/);

    // Verify #printBtn is inside the Export card (.export-block)
    const exportBlock = panel.locator(".export-block");
    await expect(exportBlock.locator("#printBtn")).toHaveCount(1);
  });

  // ==========================================================================
  // Test 2 — Print button fires window.open with blob URL
  // ==========================================================================
  test("2. Clicking Print button calls window.open with a blob URL", async ({ page }) => {
    // Intercept window.open before page scripts run
    await page.addInitScript(() => {
      window._openCallArgs = [];
      window.open = (...args) => {
        window._openCallArgs.push(args);
        return { closed: false };
      };
    });

    await seedAndLoad(page);
    await openSystemPanel(page);
    await page.waitForFunction(() => window.jspdf && window.jspdf.jsPDF);

    await page.locator("#printBtn").click();

    const callArgs = await page.evaluate(() => window._openCallArgs);
    expect(callArgs).toHaveLength(1);
    expect(callArgs[0][0]).toMatch(/^blob:/);
    expect(callArgs[0][1]).toBe("_blank");
  });

  // ==========================================================================
  // Test 3 — Restore ZIP is in Import card, not Export card
  // ==========================================================================
  test("3. #importZipBtn is inside Import card, not Export card", async ({ page }) => {
    await seedAndLoad(page);
    await openSystemPanel(page);

    const panel = page.locator("#settingsPanel_system");

    // Present in Import card (import-block)
    const importBlock = panel.locator(".import-block");
    await expect(importBlock.locator("#importZipBtn")).toHaveCount(1);
    await expect(importBlock.locator("#importZipFile")).toHaveCount(1);

    // Absent from Export card (export-block)
    const exportBlock = panel.locator(".export-block");
    await expect(exportBlock.locator("#importZipBtn")).toHaveCount(0);
    await expect(exportBlock.locator("#importZipFile")).toHaveCount(0);
  });

  // ==========================================================================
  // Test 4 — Data Reset button sizing
  // ==========================================================================
  test("4. Data Reset buttons have card-button inline sizing styles", async ({ page }) => {
    await seedAndLoad(page);
    await openSystemPanel(page);

    const panel = page.locator("#settingsPanel_system");

    for (const id of ["removeInventoryDataBtn", "boatingAccidentBtn"]) {
      const btn = panel.locator(`#${id}`);
      await expect(btn).toBeVisible();

      const style = await btn.getAttribute("style");
      expect(style).toContain("font-size: 0.82rem");
      expect(style).toContain("0.4rem");
      expect(style).toContain("0.6rem");
    }
  });

  // ==========================================================================
  // Test 5 — PDF export regression (exportPdf still calls doc.save)
  // ==========================================================================
  test("5. Export PDF still calls doc.save with correct filename after refactor", async ({
    page,
  }) => {
    await seedAndLoad(page);
    await openSystemPanel(page);

    // Wrap the jsPDF constructor so every new instance gets a save spy.
    // Prototype patching alone is unreliable against minified UMD builds.
    await page.waitForFunction(() => window.jspdf && window.jspdf.jsPDF);
    await page.evaluate(() => {
      window._pdfSaveCalls = [];
      const OrigJsPDF = window.jspdf.jsPDF;
      function SpyJsPDF(...args) {
        const inst = new OrigJsPDF(...args);
        inst.save = (filename) => {
          window._pdfSaveCalls.push(filename);
        };
        return inst;
      }
      SpyJsPDF.prototype = OrigJsPDF.prototype;
      window.jspdf.jsPDF = SpyJsPDF;
    });

    await page.locator("#exportPdfBtn").click();

    const calls = await page.evaluate(() => window._pdfSaveCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^metal_inventory_\d{8}\.pdf$/);
  });
});

import { test, expect } from "../helpers/mocks/extended-test.js";

// STRK-165 interim — the Numista CSV importer is gated as a one-time ONBOARDING
// action. Because merge de-duplication is unreliable (it appends duplicates), the
// importer now REPLACES the inventory after an explicit confirm instead of merging.
// Confirming replaces; cancelling leaves the inventory untouched. This is the guard
// that prevents the silent duplication bug until instance-aware dedup lands.

const mk = (over) => ({
  uuid: over.uuid,
  metal: "Silver",
  composition: "Silver",
  name: over.name,
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 0,
  date: "2026-06-06",
  purchaseLocation: "StakTrakr",
  storageLocation: "",
  notes: "",
  year: over.year,
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  purity: 0.999,
  spotPriceAtPurchase: 30,
  premiumPerOz: 0,
  totalPremium: 0,
  numistaId: over.numistaId,
  serial: over.serial,
});

const EXISTING = [
  mk({ uuid: "ex-1", name: "Existing One", year: "2020", numistaId: "111", serial: 1 }),
  mk({ uuid: "ex-2", name: "Existing Two", year: "2021", numistaId: "222", serial: 2 }),
];

// Minimal Numista-style CSV: one silver coin (base metals would be skipped).
const NUMISTA_CSV = [
  "Title,Composition,Quantity,N# number,Year",
  "Test Eagle,Silver,1,99999,2024",
].join("\n");

async function seed(page, inv) {
  await page.addInitScript((data) => {
    localStorage.setItem("metalInventory", JSON.stringify(data));
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  }, inv);
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => typeof window.importNumistaCsv === "function" && Array.isArray(window.inventory)
  );
}

async function triggerImport(page, csv) {
  // Not awaited — the confirm modal appears after the async file read.
  await page.evaluate((csvText) => {
    const file = new File([csvText], "numista.csv", { type: "text/csv" });
    window.importNumistaCsv(file, false);
  }, csv);
  await expect(page.locator("#appDialogModal")).toBeVisible();
}

test.describe("STRK-165 Numista import onboarding gate", () => {
  test("confirming REPLACES the inventory (no merge-duplication)", async ({ page }) => {
    await seed(page, EXISTING);
    await gotoApp(page);
    await page.waitForFunction(() => window.inventory.length === 2);

    await triggerImport(page, NUMISTA_CSV);
    // Non-empty inventory → destructive replace warning.
    await expect(page.locator("#appDialogMessage")).toContainText(/replace/i);
    await page.click("#appDialogOk");

    await page.waitForFunction(() => window.inventory.length === 1);
    const item = await page.evaluate(() => window.inventory[0]);
    expect(item.numistaId).toBe("99999");
    expect(item.name).toContain("Test Eagle");
  });

  test("cancelling leaves the inventory untouched", async ({ page }) => {
    await seed(page, EXISTING);
    await gotoApp(page);
    await page.waitForFunction(() => window.inventory.length === 2);

    await triggerImport(page, NUMISTA_CSV);
    await page.click("#appDialogCancel");

    // The importer must not mutate inventory on cancel.
    await page.waitForTimeout(200);
    const names = await page.evaluate(() => window.inventory.map((i) => i.name));
    expect(names).toEqual(["Existing One", "Existing Two"]);
  });
});

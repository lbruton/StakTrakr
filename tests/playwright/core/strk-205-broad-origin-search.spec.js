import { test, expect } from "../helpers/mocks/extended-test.js";

// STRK-205 characterization: a lone geographic origin word ("american", "canadian",
// etc.) is NOT suppressed — it matches every item of that origin broadly. The old
// suppression guard `if (words.length === 1 && broadTerms.includes(words[0])) return false;`
// lived inside the multi-word branch (words.length >= 2), so it was unreachable dead
// code and the broad-match behavior shipped to users. This test pins that behavior so a
// future change that "fixes" the guard into the single-word path is caught as a
// deliberate behavior change, not slipped in silently.
//
// Fuzzy autocomplete is disabled here so the assertion isolates the exact field-match
// path the issue governs (the fuzzy fallback only runs when field matching fails).

const ITEM_DEFAULTS = {
  metal: "Silver",
  composition: "Silver",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 0,
  date: "2026-01-01",
  purchaseLocation: "LocalShop",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2026",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 0,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
};

const makeItem = (uuid, name, overrides = {}) => ({
  ...ITEM_DEFAULTS,
  uuid,
  name,
  ...overrides,
});

const SEED = [
  makeItem("us-eagle", "American Silver Eagle"),
  makeItem("us-buffalo", "American Gold Buffalo", { metal: "Gold", composition: "Gold" }),
  makeItem("ca-maple", "Canadian Silver Maple Leaf"),
  makeItem("control-round", "Generic Silver Round"),
];

async function seedAndGoto(page, items) {
  await page.addInitScript((inventory) => {
    localStorage.setItem("metalInventory", JSON.stringify(inventory));
    localStorage.setItem("itemTags", JSON.stringify({}));
    // Disable fuzzy autocomplete deterministically. The migration in
    // constants.js re-enables it unless the migration sentinel is already set,
    // so seed both keys.
    localStorage.setItem("featureFlags", JSON.stringify({ FUZZY_AUTOCOMPLETE: false }));
    localStorage.setItem("ff_migration_fuzzy_autocomplete", "1");
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") {
          localStorage.setItem("ackVersion", APP_VERSION);
        }
      },
      { once: true }
    );
  }, items);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      Array.isArray(window.inventory) &&
      typeof window.filterInventory === "function" &&
      window.featureFlags &&
      window.featureFlags.isEnabled("FUZZY_AUTOCOMPLETE") === false
  );
}

async function searchUuids(page, term, expectedCount) {
  await page.fill("#searchInput", term);
  await page.waitForFunction(({ count }) => window.filterInventory().length === count, {
    count: expectedCount,
  });
  return page.evaluate(() =>
    window
      .filterInventory()
      .map((item) => item.uuid)
      .sort()
  );
}

test.describe("STRK-205 broad-origin single-word search", () => {
  test("a lone origin word matches every item of that origin (not suppressed)", async ({
    page,
  }) => {
    await seedAndGoto(page, SEED);

    // "american" matches BOTH American items — broad origin match, not suppressed to zero.
    expect(await searchUuids(page, "american", 2)).toEqual(["us-buffalo", "us-eagle"]);

    // A different origin word matches only its own origin item.
    expect(await searchUuids(page, "canadian", 1)).toEqual(["ca-maple"]);
  });

  test("an origin word with no matching items still returns zero (no crash)", async ({ page }) => {
    await seedAndGoto(page, SEED);

    // "mexican" is a broad term but no item carries it — empty result, not an error.
    expect(await searchUuids(page, "mexican", 0)).toEqual([]);
  });
});

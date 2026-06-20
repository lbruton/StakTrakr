import { test, expect } from "../helpers/mocks/extended-test.js";

// STRK-205 characterization: a lone geographic origin word ("american", "canadian",
// etc.) is NOT suppressed — it matches every item of that origin broadly. The old
// suppression guard `if (words.length === 1 && broadTerms.includes(words[0])) return false;`
// lived inside the multi-word branch (words.length >= 2), so it was unreachable dead
// code and the broad-match behavior shipped to users. This test pins that behavior so a
// future change that "fixes" the guard into the single-word path is caught as a
// deliberate behavior change, not slipped in silently.
//
// Assertions are on the rendered inventory table (the user-visible search contract),
// not on internal filter state. Fuzzy autocomplete is disabled here so the rendered
// rows isolate the exact field-match path the issue governs (the fuzzy fallback only
// runs when field matching fails).

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
  // Confirm fuzzy is disabled and every seeded item has rendered into the table
  // before any search runs.
  await page.waitForFunction(
    (expectedRows) =>
      window.featureFlags &&
      window.featureFlags.isEnabled("FUZZY_AUTOCOMPLETE") === false &&
      document.querySelectorAll("#inventoryTable tbody tr [data-column='name']").length ===
        expectedRows,
    items.length
  );
}

const NAME_CELL = "#inventoryTable tbody tr [data-column='name']";

// Drives the real search box and asserts on the rendered table rows. Waits out the
// input debounce by polling the rendered name-cell count, then verifies each expected
// item name is visible exactly once.
async function expectSearchRows(page, term, expectedNames) {
  await page.fill("#searchInput", term);
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll("#inventoryTable tbody tr [data-column='name']").length === count,
    expectedNames.length
  );
  for (const name of expectedNames) {
    await expect(page.locator(NAME_CELL).filter({ hasText: name })).toHaveCount(1);
  }
}

test.describe("STRK-205 broad-origin single-word search", () => {
  test("a lone origin word matches every item of that origin (not suppressed)", async ({
    page,
  }) => {
    await seedAndGoto(page, SEED);

    // "american" renders BOTH American rows — broad origin match, not suppressed to zero.
    await expectSearchRows(page, "american", ["American Silver Eagle", "American Gold Buffalo"]);
    // The Canadian and control rows must not appear for an "american" search.
    await expect(page.locator(NAME_CELL)).toHaveCount(2);

    // A different origin word renders only its own origin row.
    await expectSearchRows(page, "canadian", ["Canadian Silver Maple Leaf"]);
    await expect(page.locator(NAME_CELL)).toHaveCount(1);
  });

  test("an origin word with no matching items shows the empty state (no crash)", async ({
    page,
  }) => {
    await seedAndGoto(page, SEED);

    // "mexican" is a broad term but no item carries it — empty-state row, not an error.
    await page.fill("#searchInput", "mexican");
    await expect(page.locator("#inventoryTable tbody tr.empty-state-row")).toBeVisible();
    await expect(page.locator(NAME_CELL)).toHaveCount(0);
    await expect(page.locator(".empty-state-row")).toContainText("No matching items found");
  });
});

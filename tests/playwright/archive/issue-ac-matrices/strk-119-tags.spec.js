import { test, expect } from "../../helpers/mocks/extended-test.js";

/**
 * Playwright TDD spec for STAK-558 — comma/semicolon delimiter support in tag input.
 *
 * Test coverage:
 *   1. Comma-separated tags in edit modal are split into separate tags
 *   2. Semicolon-separated tags in edit modal are split into separate tags
 *   3. Mixed comma+semicolon delimiters are split correctly
 *   4. Empty tokens between delimiters are skipped
 *   5. Single tag without delimiters remains unchanged
 *   6. Same delimiter-splitting behavior in view modal showTagInput
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_UUID = "stak558-delimiter-item";

const BASE_ITEM = {
  uuid: ITEM_UUID,
  metal: "Silver",
  composition: "Silver",
  name: "STAK558 Test Silver Eagle",
  qty: 1,
  type: "Coin",
  weight: 31.1,
  weightUnit: "g",
  price: 40,
  marketValue: 0,
  date: "2026-01-01",
  purchaseLocation: "staktrakr.com",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2020",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 30,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 1,
};

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Inject inventory data before page load via addInitScript.
 */
async function seedData(page, opts = {}) {
  const { inventory = [BASE_ITEM], itemTags = {} } = opts;

  await page.addInitScript(
    ({ inv, tags }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inv));
      localStorage.setItem("itemTags", JSON.stringify(tags));

      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") {
            localStorage.setItem("ackVersion", APP_VERSION);
          }
        },
        { once: true }
      );
    },
    { inv: inventory, tags: itemTags }
  );
}

/**
 * Navigate to the app and wait for core globals to be ready.
 */
async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.editItem === "function" &&
      Array.isArray(window.inventory) &&
      window.inventory.length > 0
  );
}

/**
 * Open the edit form for the item at the given inventory index.
 */
async function openEditForm(page, index = 0) {
  await page.evaluate((idx) => window.editItem(idx), index);
  await expect(page.locator("#itemModal")).toBeVisible();
}

/**
 * Open the view modal for the item at the given inventory index.
 */
async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

/**
 * Get the current tags for the seeded item from the page's runtime state.
 */
async function getItemTags(page, uuid = ITEM_UUID) {
  return page.evaluate((id) => {
    if (typeof window.getItemTags === "function") {
      return window.getItemTags(id);
    }
    const raw = localStorage.getItem("itemTags");
    const tags = raw ? JSON.parse(raw) : {};
    return tags[id] || [];
  }, uuid);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe("tags-delimiters — STAK-558 comma/semicolon splitting", () => {
  // ========================================================================
  // Test 1 — Comma-separated tags in edit modal
  // ========================================================================
  test("1. comma-separated tags in edit modal are split into separate tags", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    // Type comma-separated tags and submit
    await page.fill("#newTagInput", "Bullion, Eagle, Proof");
    await page.click("#addTagBtn");

    // Assert: three separate tags should exist
    const tags = await getItemTags(page);
    expect(tags).toHaveLength(3);
    expect(tags).toContain("Bullion");
    expect(tags).toContain("Eagle");
    expect(tags).toContain("Proof");

    // Assert: chips rendered in the modal
    const chips = page.locator("#itemModalTagsChips .tag-chip");
    await expect(chips).toHaveCount(3);
    await expect(page.locator("#itemModalTagsChips")).toContainText("Bullion");
    await expect(page.locator("#itemModalTagsChips")).toContainText("Eagle");
    await expect(page.locator("#itemModalTagsChips")).toContainText("Proof");
  });

  // ========================================================================
  // Test 2 — Semicolon-separated tags in edit modal
  // ========================================================================
  test("2. semicolon-separated tags in edit modal are split into separate tags", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    // Type semicolon-separated tags and submit
    await page.fill("#newTagInput", "Commemorative; Investment; Rare");
    await page.click("#addTagBtn");

    // Assert: three separate tags should exist
    const tags = await getItemTags(page);
    expect(tags).toHaveLength(3);
    expect(tags).toContain("Commemorative");
    expect(tags).toContain("Investment");
    expect(tags).toContain("Rare");

    // Assert: chips rendered in the modal
    const chips = page.locator("#itemModalTagsChips .tag-chip");
    await expect(chips).toHaveCount(3);
  });

  // ========================================================================
  // Test 3 — Mixed comma+semicolon delimiters
  // ========================================================================
  test("3. mixed comma and semicolon delimiters are split correctly", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    // Type mixed-delimiter tags and submit
    await page.fill("#newTagInput", "Gold,Bullion; Silver,Coin");
    await page.click("#addTagBtn");

    // Assert: four separate tags should exist
    const tags = await getItemTags(page);
    expect(tags).toHaveLength(4);
    expect(tags).toContain("Gold");
    expect(tags).toContain("Bullion");
    expect(tags).toContain("Silver");
    expect(tags).toContain("Coin");

    // Assert: chips rendered in the modal
    const chips = page.locator("#itemModalTagsChips .tag-chip");
    await expect(chips).toHaveCount(4);
  });

  // ========================================================================
  // Test 4 — Empty tokens between delimiters are skipped
  // ========================================================================
  test("4. empty tokens between delimiters are skipped", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    // Type tags with empty tokens and submit
    await page.fill("#newTagInput", "Bullion,, ,;Proof");
    await page.click("#addTagBtn");

    // Assert: only two non-empty tags should exist
    const tags = await getItemTags(page);
    expect(tags).toHaveLength(2);
    expect(tags).toContain("Bullion");
    expect(tags).toContain("Proof");

    // Assert: only two chips rendered
    const chips = page.locator("#itemModalTagsChips .tag-chip");
    await expect(chips).toHaveCount(2);
  });

  // ========================================================================
  // Test 5 — Single tag without delimiters remains unchanged
  // ========================================================================
  test("5. single tag without delimiters remains a single tag", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    // Type a single tag and submit
    await page.fill("#newTagInput", "Sovereign");
    await page.click("#addTagBtn");

    // Assert: exactly one tag
    const tags = await getItemTags(page);
    expect(tags).toHaveLength(1);
    expect(tags).toContain("Sovereign");

    // Assert: one chip rendered
    const chips = page.locator("#itemModalTagsChips .tag-chip");
    await expect(chips).toHaveCount(1);
  });

  // ========================================================================
  // Test 6 — Same behavior in view modal showTagInput
  // ========================================================================
  test("6. view modal showTagInput splits comma-separated tags", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openViewModal(page);

    // Click the "+ Tag" button in the view modal to show the input
    const addTagBtn = page.locator("#viewTagsSection .tag-add-btn");
    await expect(addTagBtn).toBeVisible();
    await addTagBtn.click();

    // The inline tag input should appear
    const tagInput = page.locator("#viewTagsSection .tag-input");
    await expect(tagInput).toBeVisible();

    // Type comma-separated tags and submit via Enter
    await tagInput.fill("Maple, Leaf, RCM");
    await tagInput.press("Enter");

    // Wait for the input to be replaced by chips
    await expect(tagInput).toBeHidden();

    // Assert: three separate tags should exist
    const tags = await getItemTags(page);
    expect(tags).toHaveLength(3);
    expect(tags).toContain("Maple");
    expect(tags).toContain("Leaf");
    expect(tags).toContain("RCM");

    // Assert: chips rendered in the view modal
    const chips = page.locator("#viewTagsSection .tag-chip");
    await expect(chips).toHaveCount(3);
  });

  // ========================================================================
  // Test 7 — View modal showTagInput splits semicolon-separated tags
  // ========================================================================
  test("7. view modal showTagInput splits semicolon-separated tags", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openViewModal(page);

    const addTagBtn = page.locator("#viewTagsSection .tag-add-btn");
    await addTagBtn.click();

    const tagInput = page.locator("#viewTagsSection .tag-input");
    await expect(tagInput).toBeVisible();
    await tagInput.fill("Gold; Silver; Platinum");
    await tagInput.press("Enter");

    await expect(tagInput).toBeHidden();

    const tags = await getItemTags(page);
    expect(tags).toHaveLength(3);
    expect(tags).toContain("Gold");
    expect(tags).toContain("Silver");
    expect(tags).toContain("Platinum");

    const chips = page.locator("#viewTagsSection .tag-chip");
    await expect(chips).toHaveCount(3);
  });

  // ========================================================================
  // Test 8 — View modal showTagInput splits mixed comma/semicolon tags
  // ========================================================================
  test("8. view modal showTagInput splits mixed comma/semicolon tags", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openViewModal(page);

    const addTagBtn = page.locator("#viewTagsSection .tag-add-btn");
    await addTagBtn.click();

    const tagInput = page.locator("#viewTagsSection .tag-input");
    await expect(tagInput).toBeVisible();
    await tagInput.fill("A, B; C, D");
    await tagInput.press("Enter");

    await expect(tagInput).toBeHidden();

    const tags = await getItemTags(page);
    expect(tags).toHaveLength(4);
    expect(tags).toContain("A");
    expect(tags).toContain("B");
    expect(tags).toContain("C");
    expect(tags).toContain("D");

    const chips = page.locator("#viewTagsSection .tag-chip");
    await expect(chips).toHaveCount(4);
  });
});

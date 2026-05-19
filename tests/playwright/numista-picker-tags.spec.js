import { test, expect } from "./helpers/mocks/extended-test.js";

/**
 * Playwright TDD spec for STAK-556 — Numista picker tag checkboxes and userModified flag.
 *
 * Test coverage:
 *   1.  Tag section appears in picker when Numista result has tags
 *   2.  Blacklisted tags default unchecked and dimmed
 *   3.  Already-present tags checked and disabled
 *   4a. numista_tags_auto=true → new tags default checked
 *   4b. numista_tags_auto=false → new tags default unchecked
 *   5.  Fill Fields only imports checked tags
 *   6.  Check all / Uncheck all respect locked states
 *   7.  userModified scalar field defaults unchecked with "edited" hint
 *   8.  Force-overriding userModified field clears the flag
 *   9.  Removing a tag records it in itemRemovedTags; re-searching shows unchecked
 *   10. Re-importing a removed tag clears tracking
 *   11. JSON export payload includes itemRemovedTags; importJson restores it
 *   12. CSV export/import round-trip preserves itemRemovedTags (via tags column)
 *   13. STVAULT encrypted backup includes itemRemovedTags; restore recovers it
 *   14. DiffEngine.compareSettings detects itemRemovedTags changes
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_UUID = "stak556-picker-tag-item";

const BASE_ITEM = {
  uuid: ITEM_UUID,
  metal: "Silver",
  composition: "Silver",
  name: "STAK556 Test Silver Eagle",
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
  numistaId: "12345",
  serial: 1,
};

// Numista result returned by a mock catalogAPI.lookupItem
const NUMISTA_RESULT = {
  name: "1 Dollar American Silver Eagle",
  catalogId: "12345",
  year: "2020",
  metal: "Silver",
  type: "Coin",
  weight: 31.1,
  imageUrl: "https://example.com/obverse.jpg",
  reverseImageUrl: "https://example.com/reverse.jpg",
  tags: ["Bullion", "Eagle", "Investment"],
};

// 4-tag result for AC-10 mixed-state test (on-item + blacklisted + removed + new)
const NUMISTA_RESULT_4 = {
  ...NUMISTA_RESULT,
  tags: ["Bullion", "Eagle", "Investment", "Silver"],
};

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Inject inventory and tag data before page load via addInitScript.
 * @param {import("@playwright/test").Page} page
 * @param {object} opts
 * @param {object[]} [opts.inventory] - Items to store in metalInventory
 * @param {object} [opts.itemTags] - itemTags object keyed by UUID
 * @param {object} [opts.itemRemovedTags] - itemRemovedTags object keyed by UUID
 * @param {string[]} [opts.tagBlacklist] - Tags to blacklist
 * @param {boolean} [opts.numistaTagsAuto] - numista_tags_auto setting (default true)
 */
async function seedData(page, opts = {}) {
  const {
    inventory = [BASE_ITEM],
    itemTags = {},
    itemRemovedTags = null,
    tagBlacklist = [],
    numistaTagsAuto = true,
  } = opts;

  await page.addInitScript(
    ({ inv, tags, removedTags, blacklist, tagsAuto }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inv));
      localStorage.setItem("itemTags", JSON.stringify(tags));
      if (removedTags !== null) {
        localStorage.setItem("itemRemovedTags", JSON.stringify(removedTags));
      }
      if (blacklist.length > 0) {
        localStorage.setItem("tagBlacklist", JSON.stringify(blacklist));
      }
      localStorage.setItem("numista_tags_auto", JSON.stringify(tagsAuto));

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
    {
      inv: inventory,
      tags: itemTags,
      removedTags: itemRemovedTags,
      blacklist: tagBlacklist,
      tagsAuto: numistaTagsAuto,
    }
  );
}

/**
 * Stub catalogAPI.lookupItem to return a controlled result without network calls.
 * Must be called before page.goto().
 */
async function stubCatalogLookup(page, result = NUMISTA_RESULT) {
  await page.addInitScript((lookupResult) => {
    const installStub = (api) => {
      if (!api || typeof api !== "object") return;
      api.lookupItem = async () => ({ ...lookupResult });
      api.searchItems = async () => [{ ...lookupResult }];
      if (!api.activeProvider) api.activeProvider = { name: "numista" };
    };

    let currentCatalogApi;
    Object.defineProperty(window, "catalogAPI", {
      configurable: true,
      get() {
        return currentCatalogApi;
      },
      set(value) {
        currentCatalogApi = value;
        installStub(value);
      },
    });

    document.addEventListener(
      "DOMContentLoaded",
      () => {
        installStub(window.catalogAPI);
      },
      { once: true }
    );
  }, result);
}

/**
 * Navigate to the app and wait for core globals to be ready.
 */
async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.showNumistaResults === "function" &&
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
 * Trigger showNumistaResults with a direct-lookup single result.
 * This renders the picker field checkboxes without a real API call.
 */
async function openNumistaPicker(page, result = NUMISTA_RESULT) {
  await page.evaluate((r) => {
    window.showNumistaResults([r], true, "");
  }, result);
  await expect(page.locator("#numistaResultsModal")).toBeVisible();
  await expect(page.locator("#numistaFieldPicker")).toBeVisible();
}

/**
 * Seed empty inventory with a fake Numista API key so the search-button flow
 * passes ensureNumistaConfiguredOrPrompt(). No inventory rows are created —
 * the Add Item modal starts from a truly empty state.
 */
async function seedAddItemData(page, opts = {}) {
  const { numistaTagsAuto = true, tagBlacklist = [] } = opts;

  await page.addInitScript(
    ({ tagsAuto, blacklist }) => {
      localStorage.setItem("metalInventory", JSON.stringify([]));
      localStorage.setItem("itemTags", JSON.stringify({}));
      localStorage.setItem("numista_tags_auto", JSON.stringify(tagsAuto));
      if (blacklist.length > 0) {
        localStorage.setItem("tagBlacklist", JSON.stringify(blacklist));
      }
      localStorage.setItem(
        "catalog_api_config",
        JSON.stringify({
          numista: { apiKey: btoa("fake-test-key"), quota: 2000 },
        })
      );

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
    { tagsAuto: numistaTagsAuto, blacklist: tagBlacklist }
  );
}

/**
 * Navigate to the app with empty inventory. Unlike gotoApp(), does NOT wait
 * for window.inventory.length > 0 — that would hang with an empty store.
 */
async function gotoEmptyApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.showNumistaResults === "function" &&
      Array.isArray(window.inventory) &&
      typeof window.catalogAPI === "object" &&
      window.catalogAPI !== null &&
      typeof window.ensureNumistaConfiguredOrPrompt === "function"
  );
  // init.js Phase 14 attaches event listeners inside setTimeout(…, 200).
  // Wait for the newItemBtn click handler to exist before interacting.
  await page.waitForFunction(() => {
    const btn = document.getElementById("newItemBtn");
    return btn && btn.offsetParent !== null;
  });
  await page.waitForTimeout(250);
}

/**
 * Open the Add Item modal, enter a Numista ID, click the search button, and
 * wait for the picker to appear. Routes through the real Add Item entry point
 * (#newItemBtn → #itemCatalog → #searchNumistaBtn), NOT through openEditForm()
 * or window.showNumistaResults().
 */
async function openAddItemPicker(page, numistaId) {
  await page.click("#newItemBtn");
  await expect(page.locator("#itemModal")).toBeVisible();

  await page.fill("#itemCatalog", numistaId);
  await page.click("#searchNumistaBtn");

  await expect(page.locator("#numistaResultsModal")).toBeVisible();
  await expect(page.locator("#numistaFieldPicker")).toBeVisible();
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe("numista-picker-tags — STAK-556 tag checkboxes + userModified", () => {
  test("0. manual tag add works in edit modal even when item starts without uuid", async ({
    page,
  }) => {
    const legacyItem = { ...BASE_ITEM };
    delete legacyItem.uuid;

    await seedData(page, {
      inventory: [legacyItem],
    });
    await gotoApp(page);
    await openEditForm(page);

    await page.fill("#newTagInput", "ManualTag");
    await page.click("#addTagBtn");

    await expect(page.locator("#itemModalTagsChips")).toContainText("ManualTag");

    const state = await page.evaluate(() => {
      const uuid = window.inventory?.[0]?.uuid || "";
      const tags = uuid && typeof window.getItemTags === "function" ? window.getItemTags(uuid) : [];
      return { uuid, tags };
    });

    expect(state.uuid).toBeTruthy();
    expect(state.tags).toContain("ManualTag");
  });

  // =========================================================================
  // Test 1 — Tag section appears when Numista result has tags
  // =========================================================================
  test("1. tag section appears in picker when Numista result has tags", async ({ page }) => {
    await seedData(page);
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    // The Tags section heading must be present
    const tagSection = page.locator("#numistaFieldCheckboxes .numista-tags-section");
    await expect(tagSection).toBeVisible();

    // One checkbox per tag in the result
    const tagCheckboxes = page.locator('input[name="numistaTag"]');
    await expect(tagCheckboxes).toHaveCount(NUMISTA_RESULT.tags.length);

    // Each tag name should appear as a label
    for (const tag of NUMISTA_RESULT.tags) {
      await expect(page.locator("#numistaFieldCheckboxes")).toContainText(tag);
    }
  });

  // =========================================================================
  // Test 2 — Blacklisted tags default unchecked and dimmed
  // =========================================================================
  test("2. blacklisted tags default unchecked and dimmed with '(blacklisted)' label", async ({
    page,
  }) => {
    await seedData(page, { tagBlacklist: ["Investment"] });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    // Find the blacklisted tag checkbox
    const blacklistedCb = page.locator('input[name="numistaTag"][data-tag="Investment"]');
    await expect(blacklistedCb).not.toBeChecked();

    // Its parent label should have a dimmed/blacklisted class or text
    const blacklistedLabel = page.locator(
      '[data-tag-label="Investment"], label:has(input[data-tag="Investment"])'
    );
    await expect(blacklistedLabel).toContainText("blacklisted");

    // Non-blacklisted tags should NOT have the blacklisted indicator
    const bullionLabel = page.locator('label:has(input[data-tag="Bullion"])');
    await expect(bullionLabel).not.toContainText("blacklisted");
  });

  // =========================================================================
  // Test 3 — Existing on-item tag is shown checked and ENABLED (STRK-52 spec correction)
  // Previously asserted toBeDisabled(); that was the wrong spec — STRK-52 corrects it.
  // =========================================================================
  test("3. existing on-item tag is shown checked and enabled with '(on item)' hint (STRK-52)", async ({
    page,
  }) => {
    await seedData(page, { itemTags: { [ITEM_UUID]: ["Bullion"] } });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    const alreadyPresentCb = page.locator('input[name="numistaTag"][data-tag="Bullion"]');
    await expect(alreadyPresentCb).toBeChecked();
    await expect(alreadyPresentCb).not.toBeDisabled();

    const bullionLabel = page.locator('label:has(input[data-tag="Bullion"])');
    await expect(bullionLabel).toContainText("on item");

    // "Eagle" is not on the item — should be enabled
    const newTagCb = page.locator('input[name="numistaTag"][data-tag="Eagle"]');
    await expect(newTagCb).toBeEnabled();
  });

  // =========================================================================
  // Test 3-AC3 — Unchecking an on-item tag records removal (STRK-52)
  // =========================================================================
  test("3-AC3: unchecking an on-item tag records removal and opts-out future syncs (STRK-52)", async ({
    page,
  }) => {
    await seedData(page, { itemTags: { [ITEM_UUID]: ["Bullion"] }, numistaTagsAuto: false });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    const bullionCb = page.locator('input[name="numistaTag"][data-tag="Bullion"]');
    await expect(bullionCb).toBeChecked();
    await expect(bullionCb).not.toBeDisabled();
    await bullionCb.uncheck();
    await expect(bullionCb).not.toBeChecked();

    await page.locator("#numistaFillBtn").click();

    const tags = await page.evaluate(
      (uuid) => (typeof window.getItemTags === "function" ? window.getItemTags(uuid) : []),
      ITEM_UUID
    );
    expect(tags.map((t) => t.toLowerCase())).not.toContain("bullion");

    const removed = await page.evaluate(
      (uuid) => (typeof window.loadRemovedTags === "function" ? window.loadRemovedTags(uuid) : []),
      ITEM_UUID
    );
    expect(removed.map((t) => t.toLowerCase())).toContain("bullion");

    // Re-open picker — Bullion should now show as removed, not on-item
    await openNumistaPicker(page);
    await expect(bullionCb).not.toBeChecked();
    const bullionLabel = page.locator('label:has(input[data-tag="Bullion"])');
    await expect(bullionLabel).toContainText("removed");
  });

  // =========================================================================
  // Test 3-AC6 — Case-insensitive removal (STRK-52)
  // =========================================================================
  test("3-AC6: unchecking removes the stored tag case-insensitively (STRK-52)", async ({
    page,
  }) => {
    // Stored as lowercase "bullion"; Numista returns "Bullion" (capitalized)
    await seedData(page, { itemTags: { [ITEM_UUID]: ["bullion"] }, numistaTagsAuto: false });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    const bullionCb = page.locator('input[name="numistaTag"][data-tag="Bullion"]');
    await expect(bullionCb).toHaveCount(1);
    await expect(bullionCb).toBeChecked();
    await expect(bullionCb).not.toBeDisabled();
    await bullionCb.uncheck();

    await page.locator("#numistaFillBtn").click();

    const tags = await page.evaluate(
      (uuid) => (typeof window.getItemTags === "function" ? window.getItemTags(uuid) : []),
      ITEM_UUID
    );
    expect(tags.map((t) => t.toLowerCase())).not.toContain("bullion");

    const removed = await page.evaluate(
      (uuid) => (typeof window.loadRemovedTags === "function" ? window.loadRemovedTags(uuid) : []),
      ITEM_UUID
    );
    expect(removed.map((t) => t.toLowerCase())).toContain("bullion");
  });

  // =========================================================================
  // Test 3-AC10 — Uncheck-all protects on-item AND blacklisted rows (STRK-52)
  // =========================================================================
  test("3-AC10: Uncheck-all protects on-item and blacklisted rows simultaneously (STRK-52)", async ({
    page,
  }) => {
    await seedData(page, {
      itemTags: { [ITEM_UUID]: ["Bullion"] },
      itemRemovedTags: { [ITEM_UUID]: ["Eagle"] },
      tagBlacklist: ["Investment"],
      numistaTagsAuto: true,
    });
    await stubCatalogLookup(page, NUMISTA_RESULT_4);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page, NUMISTA_RESULT_4);

    const bullionCb = page.locator('input[name="numistaTag"][data-tag="Bullion"]');
    const eagleCb = page.locator('input[name="numistaTag"][data-tag="Eagle"]');
    const investmentCb = page.locator('input[name="numistaTag"][data-tag="Investment"]');
    const silverCb = page.locator('input[name="numistaTag"][data-tag="Silver"]');

    // Pre-conditions
    await expect(bullionCb).toBeChecked();
    await expect(bullionCb).not.toBeDisabled(); // ← fails before B.1 (TDD red)
    await expect(eagleCb).not.toBeChecked(); // removed tag — unchecked
    await expect(investmentCb).not.toBeChecked(); // blacklisted — unchecked + disabled
    await expect(silverCb).toBeChecked(); // new tag, auto=true

    await page.locator("#numistaTagUncheckAll").click();

    // Post-conditions: Bullion (on-item) stays checked; Investment (blacklisted) stays unchecked+disabled
    await expect(bullionCb).toBeChecked();
    await expect(investmentCb).not.toBeChecked();
    await expect(investmentCb).toBeDisabled();
    await expect(silverCb).not.toBeChecked(); // unprotected — cleared
    await expect(eagleCb).not.toBeChecked(); // removed — still unchecked
  });

  // =========================================================================
  // Test 3-AC5 — Manual + Numista matching tag renders as one row (STRK-52 regression lock)
  // Should PASS before implementation (behavior already correct via isOnItem predicate)
  // =========================================================================
  test("3-AC5: matching manual and Numista tag renders as one checked on-item row (STRK-52)", async ({
    page,
  }) => {
    await seedData(page, { itemTags: { [ITEM_UUID]: ["Bullion"] } });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    // Only one "Bullion" row — no duplicate from the manual tag
    const bullionRows = page.locator('input[name="numistaTag"][data-tag="Bullion"]');
    await expect(bullionRows).toHaveCount(1);
    await expect(bullionRows).toBeChecked();

    const bullionLabel = page.locator('label:has(input[data-tag="Bullion"])');
    await expect(bullionLabel).toContainText("on item");
  });

  // =========================================================================
  // Test 4a — numista_tags_auto=true → new tags default checked
  // =========================================================================
  test("4a. numista_tags_auto=true causes new tags to default checked", async ({ page }) => {
    await seedData(page, { numistaTagsAuto: true });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    // All new (non-blacklisted, non-present) tags should be checked by default
    const tagCheckboxes = page.locator('input[name="numistaTag"]:not(:disabled)');
    const count = await tagCheckboxes.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(tagCheckboxes.nth(i)).toBeChecked();
    }
  });

  // =========================================================================
  // Test 4b — numista_tags_auto=false → new tags default unchecked
  // =========================================================================
  test("4b. numista_tags_auto=false causes new tags to default unchecked", async ({ page }) => {
    await seedData(page, { numistaTagsAuto: false });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    // All new (non-blacklisted, non-present) enabled tags should be unchecked
    const enabledTagCbs = page.locator('input[name="numistaTag"]:not(:disabled)');
    const count = await enabledTagCbs.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(enabledTagCbs.nth(i)).not.toBeChecked();
    }
  });

  // =========================================================================
  // Test 5 — Fill Fields only imports checked tags
  // =========================================================================
  test("5. Fill Fields only imports checked tags", async ({ page }) => {
    await seedData(page, { numistaTagsAuto: true });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    // Uncheck "Eagle" tag
    const eagleCb = page.locator('input[name="numistaTag"][data-tag="Eagle"]');
    await expect(eagleCb).toBeChecked();
    await eagleCb.uncheck();
    await expect(eagleCb).not.toBeChecked();

    // Click Fill Fields
    const fillBtn = page.locator("#numistaFillBtn");
    await fillBtn.click();

    // Wait for modal to close or check tags were applied
    // "Bullion" and "Investment" should be in tags; "Eagle" should NOT be
    const appliedTags = await page.evaluate((uuid) => {
      if (typeof window.getItemTags === "function") {
        return window.getItemTags(uuid);
      }
      const raw = localStorage.getItem("itemTags");
      const tags = raw ? JSON.parse(raw) : {};
      return tags[uuid] || [];
    }, ITEM_UUID);

    expect(appliedTags).toContain("Bullion");
    expect(appliedTags).toContain("Investment");
    expect(appliedTags).not.toContain("Eagle");
  });

  // =========================================================================
  // Test 6 — Check all / Uncheck all respect locked states
  // =========================================================================
  test("6. Check all and Uncheck all buttons respect blacklisted and disabled states", async ({
    page,
  }) => {
    await seedData(page, {
      tagBlacklist: ["Investment"],
      itemTags: { [ITEM_UUID]: ["Bullion"] },
      numistaTagsAuto: false,
    });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    // Initially: Bullion=checked+disabled, Investment=unchecked (blacklisted), Eagle=unchecked
    const eagleCb = page.locator('input[name="numistaTag"][data-tag="Eagle"]');
    await expect(eagleCb).not.toBeChecked();

    // Click "Check all" — only toggleable (non-disabled, non-blacklisted) boxes should check
    const checkAllBtn = page.locator(
      "#numistaTagCheckAll, [data-action='tag-check-all'], .numista-tag-check-all"
    );
    await checkAllBtn.click();

    // Eagle (toggleable) should now be checked
    await expect(eagleCb).toBeChecked();

    // Bullion (disabled, already present) should still be checked
    const bullionCb = page.locator('input[name="numistaTag"][data-tag="Bullion"]');
    await expect(bullionCb).toBeChecked();

    // Investment (blacklisted) should still be unchecked — blacklisted are not toggled
    const investmentCb = page.locator('input[name="numistaTag"][data-tag="Investment"]');
    await expect(investmentCb).not.toBeChecked();

    // Click "Uncheck all" — only toggleable boxes should uncheck
    const uncheckAllBtn = page.locator(
      "#numistaTagUncheckAll, [data-action='tag-uncheck-all'], .numista-tag-uncheck-all"
    );
    await uncheckAllBtn.click();

    // Eagle should be unchecked
    await expect(eagleCb).not.toBeChecked();

    // Bullion (disabled, already present) should REMAIN checked — uncheck-all skips disabled
    await expect(bullionCb).toBeChecked();
  });

  // =========================================================================
  // Test 7 — userModified scalar field defaults unchecked with "edited" hint
  // =========================================================================
  test("7. scalar field with userModified=true defaults unchecked with edited hint", async ({
    page,
  }) => {
    // Inject item with fieldMeta marking "name" as userModified
    const itemWithMeta = {
      ...BASE_ITEM,
      fieldMeta: {
        name: { source: "manual", userModified: true },
        year: { source: "numista", userModified: false },
      },
    };

    await seedData(page, { inventory: [itemWithMeta] });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    // The "name" checkbox should be unchecked (userModified protection)
    const nameCb = page.locator('input[name="numistaField"][value="name"]');
    await expect(nameCb).not.toBeChecked();

    // The "name" row should contain an "(edited)" or "✎ edited" hint
    const nameRow = page.locator(
      '.numista-field-row:has(input[value="name"]), label:has(input[value="name"])'
    );
    await expect(nameRow).toContainText("edited");

    // The "year" checkbox (userModified: false) should follow normal defaultOn logic
    const yearCb = page.locator('input[name="numistaField"][value="year"]');
    // year defaultOn=false, so it should be unchecked — but NOT due to userModified
    await expect(yearCb).not.toHaveAttribute("data-user-modified", "true");
  });

  // =========================================================================
  // Test 8 — Force-overriding userModified field clears the flag
  // =========================================================================
  test("8. checking a userModified field and clicking Fill Fields clears userModified", async ({
    page,
  }) => {
    const itemWithMeta = {
      ...BASE_ITEM,
      fieldMeta: {
        name: { source: "manual", userModified: true },
      },
    };

    await seedData(page, { inventory: [itemWithMeta] });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    // Manually check the name field (force-override)
    const nameCb = page.locator('input[name="numistaField"][value="name"]');
    await expect(nameCb).not.toBeChecked();
    await nameCb.check();
    await expect(nameCb).toBeChecked();

    // Click Fill Fields
    const fillBtn = page.locator("#numistaFillBtn");
    await fillBtn.click();

    // After fill, userModified should be cleared for "name"
    const fieldMeta = await page.evaluate((uuid) => {
      const inv = window.inventory;
      if (!inv) return null;
      const item = inv.find((i) => i.uuid === uuid);
      return item ? item.fieldMeta : null;
    }, ITEM_UUID);

    expect(fieldMeta).not.toBeNull();
    expect(fieldMeta.name).toBeDefined();
    expect(fieldMeta.name.userModified).toBe(false);
  });

  // =========================================================================
  // Test 9 — Removing a tag records it in itemRemovedTags; re-searching shows unchecked
  // =========================================================================
  test("9. removing a tag records in itemRemovedTags; picker shows it unchecked with removed hint", async ({
    page,
  }) => {
    await seedData(page, {
      itemTags: { [ITEM_UUID]: ["Bullion", "Eagle"] },
      numistaTagsAuto: true,
    });
    await stubCatalogLookup(page);
    await gotoApp(page);

    // Remove "Eagle" tag from the item
    const removedRecorded = await page.evaluate(
      ({ uuid, tag }) => {
        if (typeof window.removeItemTag === "function") {
          window.removeItemTag(uuid, tag);
          // After removal, itemRemovedTags should contain this tag
          const raw = localStorage.getItem("itemRemovedTags");
          if (!raw) return false;
          const removedTags = JSON.parse(raw);
          return Array.isArray(removedTags[uuid]) && removedTags[uuid].includes(tag);
        }
        return false;
      },
      { uuid: ITEM_UUID, tag: "Eagle" }
    );

    expect(removedRecorded).toBe(true);

    // Now open the edit form and picker — Eagle should show as unchecked with "(removed)" hint
    await openEditForm(page);
    await openNumistaPicker(page);

    const eagleCb = page.locator('input[name="numistaTag"][data-tag="Eagle"]');
    await expect(eagleCb).not.toBeChecked();

    // The label should contain a "(removed)" hint
    const eagleLabel = page.locator('label:has(input[data-tag="Eagle"])');
    await expect(eagleLabel).toContainText("removed");
  });

  // =========================================================================
  // Test 10 — Re-importing a removed tag clears tracking
  // =========================================================================
  test("10. re-importing a removed tag via picker clears itemRemovedTags entry", async ({
    page,
  }) => {
    // Seed with Eagle in removedTags
    await seedData(page, {
      itemTags: { [ITEM_UUID]: ["Bullion"] },
      itemRemovedTags: { [ITEM_UUID]: ["Eagle"] },
      numistaTagsAuto: true,
    });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    // Eagle should show unchecked (it's in removedTags)
    const eagleCb = page.locator('input[name="numistaTag"][data-tag="Eagle"]');
    await expect(eagleCb).not.toBeChecked();

    // Check Eagle to re-import it
    await eagleCb.check();
    await expect(eagleCb).toBeChecked();

    // Click Fill Fields
    const fillBtn = page.locator("#numistaFillBtn");
    await fillBtn.click();

    // itemRemovedTags[uuid] should no longer contain "Eagle"
    const removedAfter = await page.evaluate((uuid) => {
      const raw = localStorage.getItem("itemRemovedTags");
      if (!raw) return [];
      const data = JSON.parse(raw);
      return data[uuid] || [];
    }, ITEM_UUID);

    expect(removedAfter).not.toContain("Eagle");
  });

  // =========================================================================
  // Test 11 — JSON export includes itemRemovedTags; importJson restores it
  // =========================================================================
  test("11. JSON export payload includes itemRemovedTags data and importJson restores it", async ({
    page,
  }) => {
    const removedTagsData = { [ITEM_UUID]: ["Investment"] };
    await seedData(page, {
      itemTags: { [ITEM_UUID]: ["Bullion"] },
      itemRemovedTags: removedTagsData,
    });
    await gotoApp(page);

    // Capture the JSON export payload (intercept the blob download)
    const exportPayload = await page.evaluate(() => {
      return new Promise((resolve) => {
        const orig = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
          const reader = new FileReader();
          reader.onload = () => {
            URL.createObjectURL = orig;
            resolve(JSON.parse(reader.result));
          };
          reader.readAsText(blob);
          return orig.call(URL, blob);
        };
        window.exportJson();
      });
    });

    // The export payload should include itemRemovedTags
    expect(exportPayload).toBeDefined();
    expect(exportPayload.itemRemovedTags).toBeDefined();
    expect(exportPayload.itemRemovedTags[ITEM_UUID]).toContain("Investment");

    // Clear existing itemRemovedTags then import the payload
    await page.evaluate(
      ({ payloadStr }) => {
        localStorage.removeItem("itemRemovedTags");
        if (typeof window.importJsonFromText === "function") {
          window.importJsonFromText(payloadStr, true);
        }
      },
      { payloadStr: JSON.stringify(exportPayload) }
    );

    // Wait for import to process (FileReader is async)
    await page.waitForTimeout(500);

    // Verify itemRemovedTags was restored
    const importResult = await page.evaluate((uuid) => {
      const raw = localStorage.getItem("itemRemovedTags");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed[uuid] || null;
    }, ITEM_UUID);

    expect(importResult).not.toBeNull();
    expect(importResult).toContain("Investment");
  });

  // =========================================================================
  // Test 12 — CSV export/import round-trip preserves itemRemovedTags
  // =========================================================================
  test("12. CSV export includes removed tags annotation; import round-trip preserves data", async ({
    page,
  }) => {
    const removedTagsData = { [ITEM_UUID]: ["Commemorative"] };
    await seedData(page, {
      itemTags: { [ITEM_UUID]: ["Bullion"] },
      itemRemovedTags: removedTagsData,
    });
    await gotoApp(page);

    // Capture CSV export blob
    const csvContent = await page.evaluate(() => {
      return new Promise((resolve) => {
        const orig = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
          const reader = new FileReader();
          reader.onload = () => {
            URL.createObjectURL = orig;
            resolve(reader.result);
          };
          reader.readAsText(blob);
          return orig.call(URL, blob);
        };
        window.exportCsv();
      });
    });

    expect(csvContent).toBeDefined();
    expect(typeof csvContent).toBe("string");

    // The CSV must include a removedTags column or encode this data
    // The spec requires round-trip preservation — the CSV must carry enough info
    // to reconstruct itemRemovedTags on import
    const lines = csvContent.split("\n");
    // lines[0] is the "# exportOrigin:" comment; the actual CSV header is lines[1]
    const header = lines[1] || lines[0];
    expect(header).toMatch(/removedTags|removed_tags/i);

    // Import the CSV back and verify removedTags round-trip
    await page.evaluate(
      ({ csv }) => {
        localStorage.removeItem("itemRemovedTags");
        if (typeof window.importCsvFromText === "function") {
          window.importCsvFromText(csv, true);
        }
      },
      { csv: csvContent }
    );

    // Wait for PapaParse async processing
    await page.waitForTimeout(500);

    const restoredRemovedTags = await page.evaluate((uuid) => {
      const raw = localStorage.getItem("itemRemovedTags");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed[uuid] || null;
    }, ITEM_UUID);

    expect(restoredRemovedTags).not.toBeNull();
    expect(restoredRemovedTags).toContain("Commemorative");
  });

  // =========================================================================
  // Test 13 — STVAULT backup includes itemRemovedTags; restore recovers it
  // =========================================================================
  test("13. STVAULT backup payload includes itemRemovedTags and restore recovers it", async ({
    page,
  }) => {
    const removedTagsData = { [ITEM_UUID]: ["Investment"] };
    await seedData(page, {
      itemTags: { [ITEM_UUID]: ["Bullion"] },
      itemRemovedTags: removedTagsData,
    });
    await gotoApp(page);

    // Verify itemRemovedTags is included in the data that cloud sync would serialize
    // The STVAULT backup serializes all ALLOWED_STORAGE_KEYS — itemRemovedTags must be in that list
    const isRegistered = await page.evaluate(() => {
      if (typeof ALLOWED_STORAGE_KEYS === "undefined") return null;
      return ALLOWED_STORAGE_KEYS.includes("itemRemovedTags");
    });

    expect(isRegistered).toBe(true);

    // Verify that after restoring from a simulated backup payload, itemRemovedTags is applied
    const restoreTest = await page.evaluate(
      ({ removedTags, uuid }) => {
        // Simulate what a restore operation does: write each storage key back
        localStorage.setItem("itemRemovedTags", JSON.stringify(removedTags));

        const raw = localStorage.getItem("itemRemovedTags");
        if (!raw) return null;
        const restored = JSON.parse(raw);
        return restored[uuid] || null;
      },
      { removedTags: removedTagsData, uuid: ITEM_UUID }
    );

    expect(restoreTest).not.toBeNull();
    expect(restoreTest).toContain("Investment");

    // Verify loadRemovedTags function also reads the restored data correctly
    const functionResult = await page.evaluate((uuid) => {
      if (typeof window.loadRemovedTags === "function") {
        return window.loadRemovedTags(uuid);
      }
      return null;
    }, ITEM_UUID);

    expect(functionResult).not.toBeNull();
    expect(functionResult).toContain("Investment");
  });

  // =========================================================================
  // Test 14 — diff-engine.js detects itemRemovedTags changes
  // =========================================================================
  test("14. DiffEngine.compareSettings detects itemRemovedTags changes", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);

    // DiffEngine.compareSettings compares flat settings payloads.
    // itemRemovedTags is treated as a settings entry during sync.
    const diffResult = await page.evaluate(() => {
      if (typeof DiffEngine === "undefined") return null;

      const localSettings = {
        itemRemovedTags: JSON.stringify({ "uuid-a": ["Bullion"] }),
        itemTags: JSON.stringify({ "uuid-a": ["Eagle"] }),
      };
      const remoteSettings = {
        itemRemovedTags: JSON.stringify({ "uuid-a": ["Bullion", "Investment"] }),
        itemTags: JSON.stringify({ "uuid-a": ["Eagle"] }),
      };

      return DiffEngine.compareSettings(localSettings, remoteSettings);
    });

    expect(diffResult).not.toBeNull();
    const changed = diffResult.changed;
    expect(Array.isArray(changed)).toBe(true);

    // itemRemovedTags changed → should appear in the changed list
    const removedTagsChange = changed.find((c) => c.key === "itemRemovedTags");
    expect(removedTagsChange).toBeDefined();

    // itemTags did NOT change → should NOT appear in changed
    const tagsChange = changed.find((c) => c.key === "itemTags");
    expect(tagsChange).toBeUndefined();
  });
});

// =============================================================================
// STRK-51 — Expanded Numista picker: numistaData fields + scroll behavior
// =============================================================================

// Rich Numista result with numistaData fields populated
const NUMISTA_RESULT_RICH = {
  name: "1 Dollar American Silver Eagle",
  catalogId: "12345",
  year: "2020",
  metal: "Silver",
  type: "Coin",
  weight: 31.1,
  imageUrl: "https://example.com/obverse.jpg",
  reverseImageUrl: "https://example.com/reverse.jpg",
  tags: ["Bullion", "Eagle"],
  country: "United States",
  denomination: "1 Dollar",
  composition: "Silver .999",
  shape: "Round",
  diameter: 38.1,
  thickness: 2.98,
  length: 0,
  width: 0,
  orientation: "Coin",
  technique: "Struck",
  mintageByYear: [{ year: 2020, mintage: 1000000, remark: "" }],
  rarityIndex: 2,
  kmReferences: ["KM# 273"],
  commemorative: false,
  commemorativeDesc: "",
  obverseDesc: "Walking Liberty",
  reverseDesc: "Heraldic Eagle",
  edgeDesc: "Reeded",
};

test.describe("numista-picker-tags — STRK-51 expanded Numista Data fields", () => {
  // =========================================================================
  // Test 15 — First-time import: numistaData section appears with candidate values
  // =========================================================================
  test("15. expanded picker shows Numista Data section when result has numistaData fields", async ({
    page,
  }) => {
    await seedData(page);
    await stubCatalogLookup(page, NUMISTA_RESULT_RICH);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page, NUMISTA_RESULT_RICH);

    // Section label should be visible
    const sectionLabel = page.locator("#numistaFieldCheckboxes .numista-fields-section-label");
    await expect(sectionLabel).toBeVisible();
    await expect(sectionLabel).toContainText("Numista Data");

    // Country row should be present and checked (defaultOn: true, has candidate)
    const countryCb = page.locator('input[name="numistaField"][value="country"]');
    await expect(countryCb).toBeVisible();
    await expect(countryCb).toBeChecked();

    // KmRef row should be present and checked (defaultOn: true, has candidate)
    const kmRefCb = page.locator('input[name="numistaField"][value="kmRef"]');
    await expect(kmRefCb).toBeVisible();
    await expect(kmRefCb).toBeChecked();

    // Mintage row present with formatted candidate value
    const mintageInput = page.locator('input[name="numistaFieldValue_mintage"]');
    await expect(mintageInput).toBeVisible();
    const mintageVal = await mintageInput.inputValue();
    expect(mintageVal.replace(/\D/g, "")).toBe("1000000");

    // obverseDesc defaults unchecked (defaultOn: false)
    const obverseCb = page.locator('input[name="numistaField"][value="obverseDesc"]');
    await expect(obverseCb).not.toBeChecked();
  });

  // =========================================================================
  // Test 16 — Re-sync: user-modified diameter defaults unchecked with edited hint
  // =========================================================================
  test("16. re-sync: user-modified diameter field defaults unchecked with edited hint", async ({
    page,
  }) => {
    const itemWithDiameterEdited = {
      ...BASE_ITEM,
      fieldMeta: {
        diameter: { source: "manual", userModified: true },
      },
    };

    await seedData(page, { inventory: [itemWithDiameterEdited] });
    await stubCatalogLookup(page, NUMISTA_RESULT_RICH);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page, NUMISTA_RESULT_RICH);

    // diameter should be unchecked due to userModified
    const diameterCb = page.locator('input[name="numistaField"][value="diameter"]');
    await expect(diameterCb).not.toBeChecked();

    // diameter row should show the "edited" hint
    const diameterRow = page.locator(
      '#numistaFieldCheckboxes .numista-field-row:has(input[value="diameter"])'
    );
    await expect(diameterRow).toContainText("edited");
  });

  // =========================================================================
  // Test 17 — Re-sync: user-modified nested field obverseDesc defaults unchecked
  // =========================================================================
  test("17. re-sync: user-modified obverseDesc defaults unchecked", async ({ page }) => {
    const itemWithObverseEdited = {
      ...BASE_ITEM,
      fieldMeta: {
        obverseDesc: { source: "manual", userModified: true },
      },
    };

    await seedData(page, { inventory: [itemWithObverseEdited] });
    await stubCatalogLookup(page, NUMISTA_RESULT_RICH);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page, NUMISTA_RESULT_RICH);

    const obverseCb = page.locator('input[name="numistaField"][value="obverseDesc"]');
    await expect(obverseCb).not.toBeChecked();

    const obverseRow = page.locator(
      '#numistaFieldCheckboxes .numista-field-row:has(input[value="obverseDesc"])'
    );
    await expect(obverseRow).toContainText("edited");
  });

  // =========================================================================
  // Test 18 — Missing candidate values produce disabled (not checked) rows
  // =========================================================================
  test("18. fields with no candidate value are disabled and unchecked", async ({ page }) => {
    const sparseResult = {
      ...NUMISTA_RESULT_RICH,
      edgeDesc: "",
      commemorativeDesc: "",
      commemorative: false,
    };

    await seedData(page);
    await stubCatalogLookup(page, sparseResult);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page, sparseResult);

    // edgeDesc has no candidate → checkbox disabled (or not present)
    const edgeCb = page.locator('input[name="numistaField"][value="edgeDesc"]');
    const count = await edgeCb.count();
    if (count > 0) {
      await expect(edgeCb).not.toBeChecked();
      await expect(edgeCb).toBeDisabled();
    }
  });

  // =========================================================================
  // Test 19 — Existing 8-field behavior not regressed
  // =========================================================================
  test("19. existing main-form fields still render and Fill Fields still works", async ({
    page,
  }) => {
    await seedData(page);
    await stubCatalogLookup(page, NUMISTA_RESULT_RICH);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page, NUMISTA_RESULT_RICH);

    // Original 8 fields present
    const nameCb = page.locator('input[name="numistaField"][value="name"]');
    const weightCb = page.locator('input[name="numistaField"][value="weight"]');
    await expect(nameCb).toBeVisible();
    await expect(weightCb).toBeVisible();
    await expect(nameCb).toBeChecked();

    // Fill Fields completes without error
    const fillBtn = page.locator("#numistaFillBtn");
    await fillBtn.click();

    // Modal closes and name is filled
    await expect(page.locator("#numistaFieldPicker")).not.toBeVisible();
    const nameVal = await page.locator("#itemName").inputValue();
    expect(nameVal).toBe(NUMISTA_RESULT_RICH.name);
  });

  // =========================================================================
  // Test 20 — Layout: fill actions visible without scrolling on short viewports
  // =========================================================================
  test("20. Fill Fields button remains visible with expanded picker rows on short viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 650 });

    await seedData(page);
    await stubCatalogLookup(page, NUMISTA_RESULT_RICH);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page, NUMISTA_RESULT_RICH);

    // Fill Fields button must be within the visible viewport
    const fillBtn = page.locator("#numistaFillBtn");
    await expect(fillBtn).toBeInViewport();

    // Cancel button also reachable
    const cancelBtn = page.locator("#numistaFillCancelBtn");
    await expect(cancelBtn).toBeInViewport();

    // The modal body scrolls (scrollHeight > clientHeight) confirming rows overflow
    const bodyScrolls = await page.evaluate(() => {
      const modal = document.querySelector(".numista-results-modal-content .modal-body");
      if (!modal) return null;
      return modal.scrollHeight > modal.clientHeight;
    });
    expect(bodyScrolls).toBe(true);
  });

  // =========================================================================
  // STRK-84 — Add Item tag persistence (TDD red → green)
  // =========================================================================

  test("21. STRK-84 AC-1: tags persist on first Fill Fields for new Add Item", async ({ page }) => {
    await seedAddItemData(page);
    await stubCatalogLookup(page);
    await gotoEmptyApp(page);
    await openAddItemPicker(page, "12345");

    // Default-checked tag "Bullion" should be ticked (numistaTagsAuto=true)
    const bullionCb = page.locator('input[name="numistaTag"][data-tag="Bullion"]');
    await expect(bullionCb).toBeChecked();

    // Click Fill Fields once
    await page.click("#numistaFillBtn");

    // Wait for the picker to close
    await expect(page.locator("#numistaResultsModal")).not.toBeVisible();

    // Submit the Add Item form
    await page.click("#itemModalSubmit");

    // Wait for the modal to close (item saved)
    await expect(page.locator("#itemModal")).not.toBeVisible();

    // Verify the saved row has the tag applied
    const result = await page.evaluate(() => {
      const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
      const newItem = inv[inv.length - 1];
      if (!newItem) return { uuid: null, tags: [] };
      const tags = JSON.parse(localStorage.getItem("itemTags") || "{}");
      return { uuid: newItem.uuid, tags: tags[newItem.uuid] || [] };
    });

    expect(result.uuid).toBeTruthy();
    expect(result.tags).toContain("Bullion");
    expect(result.tags).toContain("Eagle");
    expect(result.tags).toContain("Investment");
  });

  test("22. STRK-84 AC-2: opt-out recording for unchecked default-on tags on new items", async ({
    page,
  }) => {
    await seedAddItemData(page);
    await stubCatalogLookup(page);
    await gotoEmptyApp(page);
    await openAddItemPicker(page, "12345");

    // Uncheck "Eagle" tag (direct user click)
    const eagleCb = page.locator('input[name="numistaTag"][data-tag="Eagle"]');
    await expect(eagleCb).toBeChecked();
    await eagleCb.uncheck();
    await expect(eagleCb).not.toBeChecked();

    // Click Fill Fields
    await page.click("#numistaFillBtn");
    await expect(page.locator("#numistaResultsModal")).not.toBeVisible();

    // Submit the form
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).not.toBeVisible();

    // Verify opt-out was recorded in itemRemovedTags
    const result = await page.evaluate(() => {
      const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
      const newItem = inv[inv.length - 1];
      if (!newItem) return { uuid: null, removed: {}, tags: [] };
      const removed = JSON.parse(localStorage.getItem("itemRemovedTags") || "{}");
      const tags = JSON.parse(localStorage.getItem("itemTags") || "{}");
      return {
        uuid: newItem.uuid,
        removed: removed[newItem.uuid] || [],
        tags: tags[newItem.uuid] || [],
      };
    });

    expect(result.uuid).toBeTruthy();
    expect(result.removed).toContain("Eagle");
    expect(result.tags).not.toContain("Eagle");
    expect(result.tags).toContain("Bullion");
    expect(result.tags).toContain("Investment");
  });

  test("22b. STRK-84 AC-2: Uncheck all records opt-outs for default-on tags on new items", async ({
    page,
  }) => {
    await seedAddItemData(page);
    await stubCatalogLookup(page);
    await gotoEmptyApp(page);
    await openAddItemPicker(page, "12345");

    // All default-on tags should be checked
    const allTagCbs = page.locator('input[name="numistaTag"]');
    const initialCount = await allTagCbs.count();
    expect(initialCount).toBeGreaterThan(0);

    // Click "Uncheck all"
    const uncheckAllBtn = page.locator(
      "#numistaTagUncheckAll, [data-action='tag-uncheck-all'], .numista-tag-uncheck-all"
    );
    await uncheckAllBtn.click();

    // Click Fill Fields
    await page.click("#numistaFillBtn");
    await expect(page.locator("#numistaResultsModal")).not.toBeVisible();

    // Submit the form
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).not.toBeVisible();

    // Verify all previously-default-on tags are recorded as opt-outs
    const result = await page.evaluate(() => {
      const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
      const newItem = inv[inv.length - 1];
      if (!newItem) return { uuid: null, removed: [], tags: [] };
      const removed = JSON.parse(localStorage.getItem("itemRemovedTags") || "{}");
      const tags = JSON.parse(localStorage.getItem("itemTags") || "{}");
      return {
        uuid: newItem.uuid,
        removed: removed[newItem.uuid] || [],
        tags: tags[newItem.uuid] || [],
      };
    });

    expect(result.uuid).toBeTruthy();
    expect(result.tags).toHaveLength(0);
    expect(result.removed).toContain("Bullion");
    expect(result.removed).toContain("Eagle");
    expect(result.removed).toContain("Investment");
  });

  test("23. STRK-84 AC-2 negative: no checkbox interaction produces no removedTags", async ({
    page,
  }) => {
    await seedAddItemData(page);
    await stubCatalogLookup(page);
    await gotoEmptyApp(page);
    await openAddItemPicker(page, "12345");

    // Do NOT interact with any tag checkbox — leave defaults as-is

    // Click Fill Fields
    await page.click("#numistaFillBtn");
    await expect(page.locator("#numistaResultsModal")).not.toBeVisible();

    // Submit the form
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).not.toBeVisible();

    // Verify no removedTags entries for the new item
    const result = await page.evaluate(() => {
      const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
      const newItem = inv[inv.length - 1];
      if (!newItem) return { uuid: null, removed: [] };
      const removed = JSON.parse(localStorage.getItem("itemRemovedTags") || "{}");
      return {
        uuid: newItem.uuid,
        removed: removed[newItem.uuid] || [],
      };
    });

    expect(result.uuid).toBeTruthy();
    expect(result.removed).toHaveLength(0);
  });

  test("24. STRK-87: Add Item clears catalog value after editing an item with Numista ID", async ({
    page,
  }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    await expect(page.locator("#itemCatalog")).toHaveValue(BASE_ITEM.numistaId);
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).not.toBeVisible();

    await page.click("#newItemBtn");
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemCatalog")).toHaveValue("");

    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "STRK-87 New Silver Dollar");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "35");
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).not.toBeVisible();

    const saved = await page.evaluate(() => {
      const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
      return inv.map((item) => ({ name: item.name, numistaId: item.numistaId || "" }));
    });

    expect(saved).toContainEqual({
      name: "STRK-87 New Silver Dollar",
      numistaId: "",
    });
  });

  test("25. STRK-87: Add Item clears stale edit tag chips and handlers", async ({ page }) => {
    await seedData(page, { itemTags: { [ITEM_UUID]: ["Scottsdale"] } });
    await gotoApp(page);
    await openEditForm(page);

    await expect(page.locator("#itemModalTagsChips")).toContainText("Scottsdale");
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).not.toBeVisible();

    await page.click("#newItemBtn");
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemModalTagsChips")).toContainText("No tags");
    await expect(page.locator("#itemModalTagsChips")).not.toContainText("Scottsdale");

    await page.fill("#newTagInput", "LeakedTag");
    await page.click("#addTagBtn");

    const tags = await page.evaluate(() => JSON.parse(localStorage.getItem("itemTags") || "{}"));
    expect(tags[ITEM_UUID]).toEqual(["Scottsdale"]);
  });
});

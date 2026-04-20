import { test, expect } from "@playwright/test";

/**
 * STAK-437 — Remove Search Settings Tab, move controls to Filter Chips tab.
 *
 * TDD spec: 10 tests that MUST FAIL before implementation.
 *
 * Maps to requirements.md acceptance criteria:
 *   REQ-1 AC1 — No Search sidebar nav button
 *   REQ-2 AC1 — Search Behavior fieldset on Filter Chips tab
 *   REQ-2 AC3-4 — Fuzzy autocomplete toggle functional and persists
 *   REQ-3 AC1-2 — Numista Patterns fieldset with add-form and table
 *   REQ-3 AC4 — Adding custom pattern persists
 *   REQ-3 AC4 — Deleting custom pattern removes from table
 *   REQ-4 AC5 — Custom pattern Numista rewriting fires (always-on)
 *   REQ-4 AC5 — No custom patterns → no crash, normal search
 *   REQ-6 AC1-2 — ASE default pattern pre-seeded for new users
 *   REQ-6 AC3 — Deleting pre-seeded pattern does not reappear
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openSettingsModal(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal());
  await expect(page.locator("#settingsModal")).toBeVisible();
}

async function openFilterChipsTab(page) {
  await page.evaluate(() => window.switchSettingsSection("grouping"));
  await expect(page.locator("#settingsPanel_grouping")).toBeVisible();
}

async function clearCustomRules(page) {
  await page.evaluate(() => {
    if (window.NumistaLookup) {
      const rules = NumistaLookup.getCustomRules();
      for (const r of rules) NumistaLookup.removeRule(r.id);
    }
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.describe("STAK-437 — Search tab removal and Filter Chips consolidation", () => {
  test.beforeEach(async ({ page }) => {
    // Seed minimal inventory so the app loads cleanly
    await page.addInitScript(() => {
      localStorage.setItem(
        "metalInventory",
        JSON.stringify([
          {
            uuid: "stak437-item-1",
            metal: "Silver",
            composition: "Silver",
            name: "STAK437 Test ASE",
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
          },
        ])
      );
      localStorage.setItem("itemTags", JSON.stringify({}));
      // Prevent the v3.26.01 migration from re-enabling FUZZY_AUTOCOMPLETE on reload
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
    });

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.switchSettingsSection === "function"
    );
  });

  test.afterEach(async ({ page }) => {
    await clearCustomRules(page);
  });

  // ========================================================================
  // Test 1 — REQ-1 AC1: No Search sidebar nav button
  // ========================================================================
  test("1. Settings modal opens → no data-section='search' nav button present", async ({
    page,
  }) => {
    await openSettingsModal(page);

    const searchNavBtn = page.locator('.settings-nav-item[data-section="search"]');
    await expect(searchNavBtn).toHaveCount(0);
  });

  // ========================================================================
  // Test 2 — REQ-2 AC1: Search Behavior fieldset visible at top of Filter Chips
  // ========================================================================
  test("2. Filter Chips tab → 'Search Behavior' fieldset visible at top", async ({ page }) => {
    await openSettingsModal(page);
    await openFilterChipsTab(page);

    // The fieldset must exist inside the Filter Chips panel
    const panel = page.locator("#settingsPanel_grouping");
    const searchBehaviorFieldset = panel.locator('.settings-fieldset:has-text("Search Behavior")');
    await expect(searchBehaviorFieldset).toBeVisible();

    // It must appear BEFORE the first existing Filter Chips settings-group
    // (chip threshold is the first existing group in the current markup)
    const firstExistingGroup = panel
      .locator("#settingsChipMinCount")
      .locator(
        "xpath=ancestor::*[contains(@class, 'settings-group') or contains(@class, 'settings-fieldset')][1]"
      );
    await expect(firstExistingGroup).toBeVisible();

    const searchBehaviorPrecedes = await searchBehaviorFieldset.evaluate(
      (sb, fe) => Boolean(sb.compareDocumentPosition(fe) & Node.DOCUMENT_POSITION_FOLLOWING),
      await firstExistingGroup.elementHandle()
    );
    expect(searchBehaviorPrecedes).toBe(true);
  });

  // ========================================================================
  // Test 3 — REQ-2 AC3-4: Fuzzy autocomplete toggle On/Off functional and persists
  // ========================================================================
  test("3. Fuzzy autocomplete toggle On/Off functional and persists across reload", async ({
    page,
  }) => {
    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const toggle = page.locator(
      '#settingsPanel_grouping .settings-fieldset:has-text("Search Behavior") #settingsFuzzyAutocomplete'
    );
    await expect(toggle).toBeVisible();

    // Toggle Off
    await toggle.locator('.chip-sort-btn[data-val="no"]').click();

    // Verify localStorage reflects Off
    const flagOff = await page.evaluate(() => {
      const flags = JSON.parse(localStorage.getItem("featureFlags") || "{}");
      return flags.FUZZY_AUTOCOMPLETE;
    });
    expect(flagOff).toBe(false);

    // Reload and verify toggle still shows Off
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.switchSettingsSection === "function"
    );
    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const toggleAfterReload = page.locator(
      '#settingsPanel_grouping .settings-fieldset:has-text("Search Behavior") #settingsFuzzyAutocomplete'
    );
    await expect(toggleAfterReload.locator('.chip-sort-btn[data-val="no"]')).toHaveClass(/active/);

    // Toggle back On
    await toggleAfterReload.locator('.chip-sort-btn[data-val="yes"]').click();
    const flagOn = await page.evaluate(() => {
      const flags = JSON.parse(localStorage.getItem("featureFlags") || "{}");
      return flags.FUZZY_AUTOCOMPLETE;
    });
    expect(flagOn).toBe(true);
  });

  // ========================================================================
  // Test 4 — REQ-3 AC1-2: Numista Patterns fieldset with add-form and table
  // ========================================================================
  test("4. Numista Patterns fieldset visible with add-form and #customRuleTableContainer", async ({
    page,
  }) => {
    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const panel = page.locator("#settingsPanel_grouping");
    const numistaFieldset = panel.locator('.settings-fieldset:has-text("Numista Patterns")');
    await expect(numistaFieldset).toBeVisible();

    // Add-form inputs must be present
    await expect(numistaFieldset.locator("#numistaRulePatternInput")).toBeVisible();
    await expect(numistaFieldset.locator("#numistaRuleReplacementInput")).toBeVisible();
    await expect(numistaFieldset.locator("#numistaRuleIdInput")).toBeVisible();
    await expect(numistaFieldset.locator("#addNumistaRuleBtn")).toBeVisible();

    // Table container must be present
    await expect(numistaFieldset.locator("#customRuleTableContainer")).toBeVisible();
  });

  // ========================================================================
  // Test 5 — REQ-3 AC4: Adding a custom pattern appears in table, persists on reload
  // ========================================================================
  test("5. Adding a custom Numista pattern → appears in table, persists on reload", async ({
    page,
  }) => {
    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const panel = page.locator("#settingsPanel_grouping");
    const numistaFieldset = panel.locator('.settings-fieldset:has-text("Numista Patterns")');

    await numistaFieldset.locator("#numistaRulePatternInput").fill("\\btest-pattern\\b");
    await numistaFieldset.locator("#numistaRuleReplacementInput").fill('"Test Pattern" Bullion');
    await numistaFieldset.locator("#numistaRuleIdInput").fill("9999");
    await numistaFieldset.locator("#addNumistaRuleBtn").click();

    // Pattern should appear in the table
    const table = numistaFieldset.locator("#customRuleTableContainer");
    await expect(table).toContainText("\\btest-pattern\\b");
    await expect(table).toContainText('"Test Pattern" Bullion');
    await expect(table).toContainText("9999");

    // Reload and verify persistence
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.switchSettingsSection === "function"
    );
    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const tableAfterReload = page
      .locator("#settingsPanel_grouping")
      .locator('.settings-fieldset:has-text("Numista Patterns")')
      .locator("#customRuleTableContainer");
    await expect(tableAfterReload).toContainText("\\btest-pattern\\b");
  });

  // ========================================================================
  // Test 6 — REQ-3 AC4: Deleting a custom pattern removes from table
  // ========================================================================
  test("6. Deleting a custom Numista pattern → removed from table", async ({ page }) => {
    // Pre-seed a custom rule via localStorage so it's present on load
    await page.addInitScript(() => {
      localStorage.setItem(
        "numistaLookupRules",
        JSON.stringify([
          {
            id: "custom-test-del-001",
            pattern: "\\bdelete-me\\b",
            replacement: "Deleted Pattern",
            numistaId: "8888",
            builtIn: false,
          },
        ])
      );
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.switchSettingsSection === "function"
    );

    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const numistaFieldset = page
      .locator("#settingsPanel_grouping")
      .locator('.settings-fieldset:has-text("Numista Patterns")');
    const table = numistaFieldset.locator("#customRuleTableContainer");
    await expect(table).toContainText("delete-me");

    // Click the delete button (x) in the table row
    await table.locator("button[title='Delete rule']").click();

    // Rule should be gone
    await expect(table).not.toContainText("delete-me");

    // Verify localStorage is cleared
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("numistaLookupRules") || "[]")
    );
    expect(stored).toHaveLength(0);
  });

  // ========================================================================
  // Test 7 — REQ-4 AC5: Search input with matching custom pattern → Numista rewriting fires
  // ========================================================================
  test("7. Search input with matching custom pattern → Numista rewriting fires (always-on)", async ({
    page,
  }) => {
    // Pre-seed a custom rule
    await page.addInitScript(() => {
      localStorage.setItem(
        "numistaLookupRules",
        JSON.stringify([
          {
            id: "custom-rewrite-001",
            pattern: "\\bMyTestCoin\\b",
            replacement: '"My Test Coin" Numista Query',
            numistaId: "7777",
            builtIn: false,
          },
        ])
      );
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.NumistaLookup !== "undefined"
    );

    // Verify matchQuery fires for the custom pattern regardless of any feature flag
    const matchResult = await page.evaluate(() => {
      return window.NumistaLookup.matchQuery("MyTestCoin");
    });

    expect(matchResult).not.toBeNull();
    expect(matchResult.replacement).toBe('"My Test Coin" Numista Query');
    expect(matchResult.numistaId).toBe("7777");
  });

  // ========================================================================
  // Test 8 — REQ-4 AC5: Search input with no custom patterns → no crash, normal search
  // ========================================================================
  test("8. Search input with no custom patterns → no crash, normal search", async ({ page }) => {
    // Ensure no custom rules exist
    await clearCustomRules(page);

    const matchResult = await page.evaluate(() => {
      return window.NumistaLookup.matchQuery("SomeRandomCoin");
    });

    expect(matchResult).toBeNull();

    // Also verify the app doesn't crash when searching via the search box
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.fill("#searchInput", "SomeRandomCoin");
    // Trigger search (Enter key)
    await page.press("#searchInput", "Enter");

    expect(pageErrors).toEqual([]);
  });

  // ========================================================================
  // Test 9 — REQ-6 AC1-2: ASE default pattern pre-seeded for new users
  // ========================================================================
  test("9. Fresh localStorage → ASE default pattern pre-seeded with correct values", async ({
    page,
  }) => {
    // Clear custom rules so the app thinks this is a new user (numistaLookupRules absent)
    await page.evaluate(() => {
      localStorage.removeItem("numistaLookupRules");
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.NumistaLookup !== "undefined"
    );

    // Verify the pre-seeded rule exists in NumistaLookup
    const rules = await page.evaluate(() => {
      return window.NumistaLookup.getCustomRules();
    });

    expect(rules.length).toBeGreaterThanOrEqual(1);
    const aseRule = rules.find((r) => r.numistaId === "1493");
    expect(aseRule).toBeDefined();
    expect(aseRule.pattern).toBe("\\b(american\\s+silver\\s+eagle|\\bASE\\b)");
    expect(aseRule.replacement).toBe('"American Silver Eagle" Bullion');

    // Verify it appears in the Filter Chips table
    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const numistaFieldset = page
      .locator("#settingsPanel_grouping")
      .locator('.settings-fieldset:has-text("Numista Patterns")');
    const table = numistaFieldset.locator("#customRuleTableContainer");
    await expect(table).toContainText("American Silver Eagle");
    await expect(table).toContainText("1493");
  });

  // ========================================================================
  // Test 10 — REQ-6 AC3: Deleting pre-seeded ASE pattern → does not reappear
  // ========================================================================
  test("10. Deleting pre-seeded ASE pattern → does not reappear on reload", async ({ page }) => {
    // Start fresh — remove the key so the app thinks this is a new user
    await page.evaluate(() => {
      localStorage.removeItem("numistaLookupRules");
      localStorage.removeItem("seedImagesVer");
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.NumistaLookup !== "undefined"
    );

    // Verify pre-seeded rule exists
    let rules = await page.evaluate(() => window.NumistaLookup.getCustomRules());
    const aseRule = rules.find((r) => r.numistaId === "1493");
    expect(aseRule).toBeDefined();

    // Delete the rule
    await page.evaluate((id) => window.NumistaLookup.removeRule(id), aseRule.id);

    // Reload
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.NumistaLookup !== "undefined"
    );

    // Verify the rule does NOT reappear
    rules = await page.evaluate(() => window.NumistaLookup.getCustomRules());
    expect(rules.find((r) => r.numistaId === "1493")).toBeUndefined();
  });
});

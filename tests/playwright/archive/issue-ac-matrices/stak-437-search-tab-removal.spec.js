import { test, expect } from "../../helpers/mocks/extended-test.js";

/**
 * STAK-437 — Remove Search Settings Tab, move controls to Filter Chips tab.
 *
 * Maps to requirements.md acceptance criteria:
 *   REQ-1 AC1 — No Search sidebar nav button
 *   REQ-2 AC1 — Search heading on Filter Chips tab
 *   REQ-2 AC3-4 — Fuzzy autocomplete toggle functional and persists
 *   REQ-3 AC1-2 — Numista pattern add-form and table
 *   REQ-3 AC4 — Adding custom pattern persists
 *   REQ-3 AC4 — Deleting custom pattern removes from table
 *   REQ-4 AC5 — Custom pattern Numista rewriting fires (always-on)
 *   REQ-4 AC5 — No custom patterns → no crash, normal search
 *   REQ-6 AC1-2 — Seed image demo patterns pre-seeded for new users
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
      const rules = [...window.NumistaLookup.getCustomRules()];
      for (const r of rules) window.NumistaLookup.removeRule(r.id);
    }
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.describe("STAK-437 — Search tab removal and Filter Chips consolidation", () => {
  test.beforeEach(async ({ page }) => {
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
  // Test 2 — REQ-2 AC1: Search section visible on Filter Chips tab
  // ========================================================================
  test("2. Filter Chips tab → 'Search' heading visible before Filter Chips heading", async ({
    page,
  }) => {
    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const panel = page.locator("#settingsPanel_grouping");
    const searchHeading = panel.locator('.settings-fieldset-title:has-text("Search")').first();
    await expect(searchHeading).toBeVisible();

    await expect(panel.locator("#settingsFuzzyAutocomplete")).toBeVisible();

    const filterChipsHeading = panel.locator('.settings-fieldset-title:has-text("Filter Chips")');
    await expect(filterChipsHeading).toBeVisible();

    const searchPrecedes = await searchHeading.evaluate(
      (sh, fh) => Boolean(sh.compareDocumentPosition(fh) & Node.DOCUMENT_POSITION_FOLLOWING),
      await filterChipsHeading.elementHandle()
    );
    expect(searchPrecedes).toBe(true);
  });

  // ========================================================================
  // Test 3 — REQ-2 AC3-4: Fuzzy autocomplete toggle On/Off functional and persists
  // ========================================================================
  test("3. Fuzzy autocomplete toggle On/Off functional and persists across reload", async ({
    page,
  }) => {
    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const toggle = page.locator("#settingsFuzzyAutocomplete");
    await expect(toggle).toBeVisible();

    // Toggle Off
    await toggle.locator('.chip-sort-btn[data-val="no"]').click();

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

    const toggleAfterReload = page.locator("#settingsFuzzyAutocomplete");
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
  // Test 4 — REQ-3 AC1-2: Numista Patterns add-form and table visible
  // ========================================================================
  test("4. Numista Patterns add-form and #customRuleTableContainer visible", async ({ page }) => {
    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const panel = page.locator("#settingsPanel_grouping");

    await expect(panel.locator("#numistaRulePatternInput")).toBeVisible();
    await expect(panel.locator("#numistaRuleReplacementInput")).toBeVisible();
    await expect(panel.locator("#numistaRuleIdInput")).toBeVisible();
    await expect(panel.locator("#addNumistaRuleBtn")).toBeVisible();
    await expect(panel.locator("#customRuleTableContainer")).toBeVisible();
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

    await panel.locator("#numistaRulePatternInput").fill("\\btest-pattern\\b");
    await panel.locator("#numistaRuleReplacementInput").fill('"Test Pattern" Bullion');
    await panel.locator("#numistaRuleIdInput").fill("9999");
    await panel.locator("#addNumistaRuleBtn").click();

    const table = panel.locator("#customRuleTableContainer");
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
      .locator("#customRuleTableContainer");
    await expect(tableAfterReload).toContainText("\\btest-pattern\\b");
  });

  // ========================================================================
  // Test 6 — REQ-3 AC4: Deleting a custom pattern removes from table
  // ========================================================================
  test("6. Deleting a custom Numista pattern → removed from table", async ({ page }) => {
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

    const table = page.locator("#settingsPanel_grouping").locator("#customRuleTableContainer");
    await expect(table).toContainText("delete-me");

    await table
      .locator("tr")
      .filter({ hasText: "delete-me" })
      .locator("button[title='Delete rule']")
      .click();

    await expect(table).not.toContainText("delete-me");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("numistaLookupRules") || "[]")
    );
    expect(stored.some((rule) => rule.pattern === "\\bdelete-me\\b")).toBe(false);
  });

  // ========================================================================
  // Test 7 — REQ-4 AC5: Search input with matching custom pattern → Numista rewriting fires
  // ========================================================================
  test("7. Search input with matching custom pattern → Numista rewriting fires (always-on)", async ({
    page,
  }) => {
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
    await clearCustomRules(page);

    await page.waitForFunction(() => typeof window.NumistaLookup !== "undefined");
    const matchResult = await page.evaluate(() => {
      return window.NumistaLookup.matchQuery("SomeRandomCoin");
    });

    expect(matchResult).toBeNull();

    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.fill("#searchInput", "SomeRandomCoin");
    await page.press("#searchInput", "Enter");

    expect(pageErrors).toEqual([]);
  });

  // ========================================================================
  // Test 9 — REQ-6 AC1-2: Seed image demo patterns pre-seeded for new users
  // ========================================================================
  test("9. Fresh localStorage → seed demo patterns pre-seeded with image rules", async ({
    page,
  }) => {
    await page.evaluate(() => {
      localStorage.removeItem("numistaLookupRules");
      localStorage.removeItem("seedImagesVer");
    });
    await page.reload();
    // Wait for seed rules to load (async — loadSeedImages needs IndexedDB)
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.NumistaLookup !== "undefined" &&
        window.NumistaLookup.getCustomRules().length > 0,
      { timeout: 20000 }
    );

    const rules = await page.evaluate(() => {
      return window.NumistaLookup.getCustomRules();
    });

    expect(rules.length).toBeGreaterThanOrEqual(1);
    const aseRule = rules.find((r) => /silver eagle/i.test(r.pattern));
    expect(aseRule).toBeDefined();
    expect(aseRule.replacement).toMatch(/American Silver Eagle/);

    await openSettingsModal(page);
    await openFilterChipsTab(page);

    const table = page.locator("#settingsPanel_grouping").locator("#customRuleTableContainer");
    await expect(table).toContainText("American Silver Eagle");
  });

  // ========================================================================
  // Test 10 — REQ-6 AC3: Deleting pre-seeded pattern → does not reappear
  // ========================================================================
  test("10. Deleting pre-seeded pattern → does not reappear on reload", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem("numistaLookupRules");
      localStorage.removeItem("seedImagesVer");
    });
    await page.reload();
    // Wait for seed rules to load (async — loadSeedImages needs IndexedDB)
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.NumistaLookup !== "undefined" &&
        window.NumistaLookup.getCustomRules().length > 0,
      { timeout: 20000 }
    );

    let rules = await page.evaluate(() => window.NumistaLookup.getCustomRules());
    const seedRule = rules.find((r) => /silver eagle/i.test(r.pattern));
    expect(seedRule).toBeDefined();

    await page.evaluate((id) => window.NumistaLookup.removeRule(id), seedRule.id);

    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.NumistaLookup !== "undefined"
    );

    rules = await page.evaluate(() => window.NumistaLookup.getCustomRules());
    expect(rules.find((r) => /silver eagle/i.test(r.pattern))).toBeUndefined();
  });
});

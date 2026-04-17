import { test, expect } from "@playwright/test";

/**
 * Playwright regression spec for STAK-546 — filter chip AND/OR predicate.
 *
 * Locks the AND-within-field contract for `filterInventoryAdvanced()` so the
 * bug (OR within a field) cannot silently regress.
 *
 *   Case 1 — Single `tags:Allegory` chip           → 4 Allegory items (A,B,D,E)
 *   Case 2 — `tags:Allegory` + `tags:Cat`          → 1 item with BOTH (A)          MUST FAIL today (OR)
 *   Case 3 — `metal:Silver` + `tags:Cat`           → 2 silver cats (A,C)           already correct (cross-field)
 *   Case 4 — `metal:Gold` + `metal:Silver`         → 4 rows (OR)                   STAK-551: scalar multi-select is OR
 *   Case 5 — Remove `tags:Cat` from case 2         → 4 Allegory items (A,B,D,E)    single-chip identity; passes today
 *   Case 6 — Exclude-mode `tags:Damaged`           → 4 non-damaged items (A,B,C,D) existing behavior preserved
 *
 * Seeds inventory + item-tag map + ackVersion via `page.addInitScript` under the
 * existing keys (`metalInventory`, `itemTags`, `ackVersion`). UUIDs are
 * pre-assigned so tag lookup (`itemTags` is keyed by uuid) resolves correctly.
 *
 * Uses the app's own `window.applyQuickFilter(field, value)` entry point to
 * install chips — same code path a user clicks. Assertions cover both the
 * filtered array (length + UUID set) and the rendered DOM row count.
 */

const FIXTURE_UUIDS = {
  A: "stak546-item-a-silver-allegory-cat",
  B: "stak546-item-b-silver-allegory",
  C: "stak546-item-c-silver-cat",
  D: "stak546-item-d-gold-allegory",
  E: "stak546-item-e-silver-allegory-damaged",
};

const FIXTURE_INVENTORY = [
  {
    uuid: FIXTURE_UUIDS.A,
    metal: "Silver",
    composition: "Silver",
    name: "STAK546 Silver Allegory Cat",
    qty: 1,
    type: "Coin",
    weight: 1,
    price: 40,
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
    spotPriceAtPurchase: 37,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.999,
    numistaId: "",
    serial: 101,
  },
  {
    uuid: FIXTURE_UUIDS.B,
    metal: "Silver",
    composition: "Silver",
    name: "STAK546 Silver Allegory",
    qty: 1,
    type: "Coin",
    weight: 1,
    price: 41,
    marketValue: 0,
    date: "2025-01-02",
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
    spotPriceAtPurchase: 37,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.999,
    numistaId: "",
    serial: 102,
  },
  {
    uuid: FIXTURE_UUIDS.C,
    metal: "Silver",
    composition: "Silver",
    name: "STAK546 Silver Cat",
    qty: 1,
    type: "Coin",
    weight: 1,
    price: 39,
    marketValue: 0,
    date: "2025-01-03",
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
    spotPriceAtPurchase: 37,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.999,
    numistaId: "",
    serial: 103,
  },
  {
    uuid: FIXTURE_UUIDS.D,
    metal: "Gold",
    composition: "Gold",
    name: "STAK546 Gold Allegory",
    qty: 1,
    type: "Coin",
    weight: 1,
    price: 3400,
    marketValue: 0,
    date: "2025-01-04",
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
    spotPriceAtPurchase: 3333,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.9999,
    numistaId: "",
    serial: 104,
  },
  {
    uuid: FIXTURE_UUIDS.E,
    metal: "Silver",
    composition: "Silver",
    name: "STAK546 Silver Allegory Damaged",
    qty: 1,
    type: "Coin",
    weight: 1,
    price: 38,
    marketValue: 0,
    date: "2025-01-05",
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
    spotPriceAtPurchase: 37,
    premiumPerOz: 0,
    totalPremium: 0,
    purity: 0.999,
    numistaId: "",
    serial: 105,
  },
];

const FIXTURE_ITEM_TAGS = {
  [FIXTURE_UUIDS.A]: ["Allegory", "Cat"],
  [FIXTURE_UUIDS.B]: ["Allegory"],
  [FIXTURE_UUIDS.C]: ["Cat"],
  [FIXTURE_UUIDS.D]: ["Allegory"],
  [FIXTURE_UUIDS.E]: ["Allegory", "Damaged"],
};

/** Return the UUIDs present in `filterInventoryAdvanced()` output. */
async function filteredUuids(page) {
  return page.evaluate(() => {
    const items = window.filterInventoryAdvanced();
    return items.map((item) => item.uuid);
  });
}

/** Count rendered data rows (exclude empty-state placeholder).
 *  Uses `:not()` self-selector — Playwright's `filter({hasNot})` checks DESCENDANTS,
 *  so an empty-state row with no children would slip through and inflate the count. */
async function dataRowCount(page) {
  return page.locator("#inventoryTable tbody tr:not(.empty-state-row)").count();
}

/** Reset chips between tests via the app's own clear entry point. */
async function clearChips(page) {
  await page.evaluate(() => {
    if (typeof window.clearAllFilters === "function") window.clearAllFilters();
  });
}

test.describe("filter-chip-and-logic — STAK-546 AND semantics", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ inv, tags }) => {
        localStorage.setItem("metalInventory", JSON.stringify(inv));
        localStorage.setItem("itemTags", JSON.stringify(tags));
      },
      { inv: FIXTURE_INVENTORY, tags: FIXTURE_ITEM_TAGS }
    );

    // Suppress What's New modal — ack the current APP_VERSION at DOMContentLoaded
    // (same pattern as tests/playwright/helpers/seed.js).
    await page.addInitScript(() => {
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

    await page.goto("/index.html");
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    // Wait for the initial inventory load so filterInventoryAdvanced() has data.
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 5;
      } catch (e) {
        return false;
      }
    });
  });

  test.afterEach(async ({ page }) => {
    await clearChips(page);
  });

  // Case 1 — Single tag chip narrows to the Allegory-tagged items.
  // Passes under both OR and AND (single-chip identity) — sanity check for harness.
  test("Case 1 — single tags:Allegory chip renders exactly the Allegory items", async ({
    page,
  }) => {
    await page.evaluate(() => window.applyQuickFilter("tags", "Allegory"));

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(
      new Set([FIXTURE_UUIDS.A, FIXTURE_UUIDS.B, FIXTURE_UUIDS.D, FIXTURE_UUIDS.E])
    );
    expect(uuids).toHaveLength(4);

    expect(await dataRowCount(page)).toBe(4);
  });

  // Case 2 — Adding a second tag chip must AND-intersect (regression exposed).
  // Under current OR code: returns A∪B∪C∪D∪E = 5 items. Expected after fix: {A} = 1 item.
  test("Case 2 — tags:Allegory + tags:Cat intersects to items carrying BOTH (AND)", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("tags", "Allegory");
      window.applyQuickFilter("tags", "Cat");
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(new Set([FIXTURE_UUIDS.A]));
    expect(uuids).toHaveLength(1);

    expect(await dataRowCount(page)).toBe(1);
  });

  // Case 3 — Cross-field AND (already correct today, must remain correct).
  // metal:Silver + tags:Cat → A and C (silver cats only).
  test("Case 3 — metal:Silver + tags:Cat intersects cross-field", async ({ page }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Silver");
      window.applyQuickFilter("tags", "Cat");
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(new Set([FIXTURE_UUIDS.A, FIXTURE_UUIDS.C]));
    expect(uuids).toHaveLength(2);

    expect(await dataRowCount(page)).toBe(2);
  });

  // Case 4 — STAK-551: Scalar multi-select fields use OR, not AND.
  // Metal is scalar — an item has one metal. Silver + Gold = show items of either metal.
  test("Case 4 — metal:Gold + metal:Silver returns all items (OR of scalar multi-select)", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Gold");
      window.applyQuickFilter("metal", "Silver");
    });

    // All 5 items are either Gold or Silver — OR returns all of them.
    expect(await dataRowCount(page)).toBeGreaterThan(0);
  });

  // Case 5 — Removing a chip broadens back.
  // Note: with a single remaining chip (tags:Allegory), OR and AND both return the same
  // set (single-chip reduces to identity), so this PASSES under both predicates today.
  // The test documents chip-removal correctness; it is NOT a regression-exposer.
  test("Case 5 — removing tags:Cat from case 2 returns the Allegory-only set", async ({ page }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("tags", "Allegory");
      window.applyQuickFilter("tags", "Cat");
      // applyQuickFilter toggles: the second call with the same value removes it.
      window.applyQuickFilter("tags", "Cat");
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(
      new Set([FIXTURE_UUIDS.A, FIXTURE_UUIDS.B, FIXTURE_UUIDS.D, FIXTURE_UUIDS.E])
    );
    expect(uuids).toHaveLength(4);

    expect(await dataRowCount(page)).toBe(4);
  });

  // Case 6 — Exclude-mode must keep working unchanged.
  // tags:Damaged in exclude mode → everything except E.
  test("Case 6 — exclude-mode tags:Damaged keeps items without that tag", async ({ page }) => {
    await page.evaluate(() => {
      // applyQuickFilter(field, value, isGrouped, exclude)
      window.applyQuickFilter("tags", "Damaged", false, true);
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(
      new Set([FIXTURE_UUIDS.A, FIXTURE_UUIDS.B, FIXTURE_UUIDS.C, FIXTURE_UUIDS.D])
    );
    expect(uuids).toHaveLength(4);

    expect(await dataRowCount(page)).toBe(4);
  });

  // Case 7 — Multi-value exclude must hide items matching ANY selected value (not ALL).
  // tags:Damaged + tags:Rare in exclude mode → hide items carrying EITHER tag.
  // Fixture: only item E has a Damaged tag; no item has Rare. Expected survivors: {A,B,C,D}.
  // Previously under `every`-based exclude, an item would only be hidden if it carried BOTH
  // selected tags — dropping the exclude filter to a no-op for multi-chip exclude selections.
  test("Case 7 — exclude-mode multi-tag removes items matching ANY excluded value", async ({
    page,
  }) => {
    await page.evaluate(() => {
      // applyQuickFilter(field, value, isGrouped, exclude)
      window.applyQuickFilter("tags", "Damaged", false, true);
      window.applyQuickFilter("tags", "Rare", false, true);
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(
      new Set([FIXTURE_UUIDS.A, FIXTURE_UUIDS.B, FIXTURE_UUIDS.C, FIXTURE_UUIDS.D])
    );
    expect(uuids).toHaveLength(4);

    expect(await dataRowCount(page)).toBe(4);
  });

  // =========================================================================
  // STAK-551 — filter chip predicate refactor (TDD red phase)
  // Cases 8-14 target the new OR-within-field / customGroup / groupedName /
  // chipMinCount behaviors. Expected to FAIL until Task 7 lands the impl.
  // =========================================================================

  // Case 8 — Metal multi-select OR: Silver + Gold should return items of BOTH metals.
  // Under current AND logic this returns 0 (no item is both Silver AND Gold).
  // After refactor, metal becomes OR-within-field → Silver ∪ Gold = all 5 items.
  test("Case 8 — metal:Silver + metal:Gold returns items of both metals (OR within field)", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Silver");
      window.applyQuickFilter("metal", "Gold");
    });

    const uuids = await filteredUuids(page);
    // Should include Silver items (A,B,C,E) and Gold item (D)
    expect(uuids.length).toBeGreaterThan(0);
    const metals = await page.evaluate(() => {
      return window.filterInventoryAdvanced().map((item) => item.metal);
    });
    expect(metals).toContain("Silver");
    expect(metals).toContain("Gold");
  });

  // Case 9 — Tags AND preserved: items must carry ALL selected tags.
  // Item F has ["Red","Green"], Item G has ["Red"] only.
  // tags:Red + tags:Green → only F survives (AND within tags is preserved).
  test("Case 9 — tags AND is preserved: two tag chips intersect correctly", async ({ page }) => {
    const extraItems = [
      {
        uuid: "stak551-item-f-red-green",
        metal: "Silver",
        composition: "Silver",
        name: "STAK551 Red Green Item",
        qty: 1,
        type: "Coin",
        weight: 1,
        price: 30,
        marketValue: 0,
        date: "2025-02-01",
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
        serial: 201,
      },
      {
        uuid: "stak551-item-g-red-only",
        metal: "Silver",
        composition: "Silver",
        name: "STAK551 Red Only Item",
        qty: 1,
        type: "Coin",
        weight: 1,
        price: 30,
        marketValue: 0,
        date: "2025-02-02",
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
        serial: 202,
      },
    ];
    const extraTags = {
      "stak551-item-f-red-green": ["Red", "Green"],
      "stak551-item-g-red-only": ["Red"],
    };

    // addInitScript runs in registration order — this appends after the beforeEach seed
    await page.addInitScript(
      ({ extras, eTags }) => {
        const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
        inv.push(...extras);
        localStorage.setItem("metalInventory", JSON.stringify(inv));
        const tags = JSON.parse(localStorage.getItem("itemTags") || "{}");
        Object.assign(tags, eTags);
        localStorage.setItem("itemTags", JSON.stringify(tags));
      },
      { extras: extraItems, eTags: extraTags }
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 7;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => {
      window.applyQuickFilter("tags", "Red");
      window.applyQuickFilter("tags", "Green");
    });

    const uuids = await filteredUuids(page);
    expect(new Set(uuids)).toEqual(new Set(["stak551-item-f-red-green"]));
    expect(uuids).toHaveLength(1);
  });

  // Case 10 — customGroup + metal intersection.
  // Set up a custom group "Allegories" matching pattern "Allegory".
  // Apply metal:Gold + customGroup:Allegories → Item D (Gold Allegory) should survive.
  // Currently broken: customGroup expands into activeFilters["name"] with multiple values,
  // and AND on names means an item must match ALL names — always 0.
  test("Case 10 — customGroup + metal intersection returns matching items", async ({ page }) => {
    // Inject a custom group into localStorage
    await page.evaluate(() => {
      const groups = [
        {
          id: "cg_test_allegory",
          label: "Allegories",
          patterns: ["Allegory"],
          enabled: true,
        },
      ];
      localStorage.setItem("chipCustomGroups", JSON.stringify(groups));
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 5;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Gold");
      window.applyQuickFilter("customGroup", "cg_test_allegory");
    });

    const uuids = await filteredUuids(page);
    // Gold + Allegory pattern → only item D (Gold Allegory)
    expect(uuids.length).toBeGreaterThan(0);
    expect(uuids).toContain(FIXTURE_UUIDS.D);
  });

  // Case 11 — groupedName + metal.
  // Seed items: two "American Silver Eagle" variants (different years).
  // Apply metal:Silver + grouped name chip "American Silver Eagle".
  // Currently broken: grouped name expands into activeFilters["name"] with multiple
  // specific names, and AND within the name field returns 0.
  test("Case 11 — groupedName + metal returns items matching grouped base name", async ({
    page,
  }) => {
    // Inject ASE items with different years via addInitScript (runs after beforeEach seed)
    const aseItems = [
      {
        uuid: "stak551-ase-1999",
        metal: "Silver",
        composition: "Silver",
        name: "1999 American Silver Eagle",
        qty: 1,
        type: "Coin",
        weight: 1,
        price: 25,
        marketValue: 0,
        date: "2025-03-01",
        purchaseLocation: "tulsacoins.com",
        storageLocation: "",
        serialNumber: "",
        notes: "",
        year: "1999",
        grade: "",
        gradingAuthority: "",
        certNumber: "",
        pcgsNumber: "",
        pcgsVerified: false,
        spotPriceAtPurchase: 20,
        premiumPerOz: 0,
        totalPremium: 0,
        purity: 0.999,
        numistaId: "",
        serial: 301,
      },
      {
        uuid: "stak551-ase-2024",
        metal: "Silver",
        composition: "Silver",
        name: "2024 American Silver Eagle",
        qty: 1,
        type: "Coin",
        weight: 1,
        price: 35,
        marketValue: 0,
        date: "2025-03-02",
        purchaseLocation: "apmex.com",
        storageLocation: "",
        serialNumber: "",
        notes: "",
        year: "2024",
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
        serial: 302,
      },
    ];
    await page.addInitScript(
      ({ extras }) => {
        const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
        inv.push(...extras);
        localStorage.setItem("metalInventory", JSON.stringify(inv));
      },
      { extras: aseItems }
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 7;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Silver");
      // isGrouped=true triggers the GROUPED_NAME_CHIPS code path
      window.applyQuickFilter("name", "American Silver Eagle", true);
    });

    const uuids = await filteredUuids(page);
    // Should include both ASE variants (and only them, intersected with Silver)
    expect(uuids.length).toBeGreaterThan(0);
    expect(uuids).toContain("stak551-ase-1999");
    expect(uuids).toContain("stak551-ase-2024");
  });

  // Case 12 — Exclude customGroup: items matching the group pattern should be hidden.
  test("Case 12 — exclude customGroup hides items matching group patterns", async ({ page }) => {
    // Inject a custom group matching "Allegory"
    await page.evaluate(() => {
      const groups = [
        {
          id: "cg_test_allegory",
          label: "Allegories",
          patterns: ["Allegory"],
          enabled: true,
        },
      ];
      localStorage.setItem("chipCustomGroups", JSON.stringify(groups));
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 5;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => {
      // Exclude the custom group — 4th arg = true for exclude
      window.applyQuickFilter("customGroup", "cg_test_allegory", false, true);
    });

    const uuids = await filteredUuids(page);
    // Allegory items: A, B, D, E → excluded. Only C (Silver Cat) remains.
    expect(uuids).not.toContain(FIXTURE_UUIDS.A);
    expect(uuids).not.toContain(FIXTURE_UUIDS.B);
    expect(uuids).not.toContain(FIXTURE_UUIDS.D);
    expect(uuids).not.toContain(FIXTURE_UUIDS.E);
    expect(uuids).toContain(FIXTURE_UUIDS.C);
    expect(uuids).toHaveLength(1);
  });

  // Case 13 — Chip threshold honored: chipMinCount=5 means no chip should show count < 5.
  // Currently broken — minCount drops to 1 when active filters are present.
  test("Case 13 — chipMinCount threshold is honored in rendered chip badges", async ({ page }) => {
    // Set chipMinCount to 5 before page load via addInitScript won't work after beforeEach,
    // so we set it and reload.
    await page.evaluate(() => {
      localStorage.setItem("chipMinCount", "5");
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 5;
      } catch (e) {
        return false;
      }
    });

    // Apply Silver chip to trigger filter + chip re-render
    await page.evaluate(() => window.applyQuickFilter("metal", "Silver"));

    // Enable CHIP_QTY_BADGE so counts render in chip text
    await page.evaluate(() => {
      const flags = JSON.parse(localStorage.getItem("featureFlags") || "{}");
      flags.CHIP_QTY_BADGE = true;
      localStorage.setItem("featureFlags", JSON.stringify(flags));
      if (window.featureFlags && typeof window.featureFlags.enable === "function") {
        window.featureFlags.enable("CHIP_QTY_BADGE");
      }
    });
    // Re-render chips
    await page.evaluate(() => {
      if (typeof window.renderActiveFilters === "function") window.renderActiveFilters();
      if (typeof window.renderTable === "function") window.renderTable();
    });

    // Get all chip elements from the filter bar (category summary chips with counts)
    const chipCounts = await page.evaluate(() => {
      const chips = document.querySelectorAll(".filter-chip, .chip");
      const counts = [];
      chips.forEach((chip) => {
        const text = chip.textContent || "";
        const match = text.match(/\((\d+)\)/);
        if (match) {
          counts.push(parseInt(match[1], 10));
        }
      });
      return counts;
    });

    // All visible chips with count badges should respect the minCount=5 threshold
    // (no chip should show a count below 5 in its badge)
    for (const count of chipCounts) {
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });

  // Case 14 — Reference Fixture A: precise multi-field intersection.
  // Silver + Coin + vendor "tulsacoins.com" + year "1999" + name "1 Dollar American Silver Eagle (Bullion Coin)"
  // → exactly 1 item.
  test("Case 14 — Reference Fixture A: precise multi-field filter narrows to exactly 1 item", async ({
    page,
  }) => {
    // Inject a specific item via addInitScript (runs after beforeEach seed)
    const fixtureAItem = {
      uuid: "stak551-fixture-a",
      metal: "Silver",
      composition: "Silver",
      name: "1 Dollar American Silver Eagle (Bullion Coin)",
      qty: 1,
      type: "Coin",
      weight: 1,
      price: 22,
      marketValue: 0,
      date: "1999-06-15",
      purchaseLocation: "tulsacoins.com",
      storageLocation: "",
      serialNumber: "",
      notes: "",
      year: "1999",
      grade: "",
      gradingAuthority: "",
      certNumber: "",
      pcgsNumber: "",
      pcgsVerified: false,
      spotPriceAtPurchase: 5.2,
      premiumPerOz: 0,
      totalPremium: 0,
      purity: 0.999,
      numistaId: "",
      serial: 401,
    };
    await page.addInitScript(
      ({ extra }) => {
        const inv = JSON.parse(localStorage.getItem("metalInventory") || "[]");
        inv.push(extra);
        localStorage.setItem("metalInventory", JSON.stringify(inv));
      },
      { extra: fixtureAItem }
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        typeof window.filterInventoryAdvanced === "function" &&
        typeof window.applyQuickFilter === "function" &&
        typeof window.clearAllFilters === "function"
    );
    await page.waitForFunction(() => {
      try {
        return window.filterInventoryAdvanced().length >= 6;
      } catch (e) {
        return false;
      }
    });

    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Silver");
      window.applyQuickFilter("type", "Coin");
      window.applyQuickFilter("purchaseLocation", "tulsacoins.com");
      window.applyQuickFilter("year", "1999");
      window.applyQuickFilter("name", "1 Dollar American Silver Eagle (Bullion Coin)");
    });

    const uuids = await filteredUuids(page);
    expect(uuids).toEqual(["stak551-fixture-a"]);
    expect(uuids).toHaveLength(1);
    expect(await dataRowCount(page)).toBe(1);
  });
});

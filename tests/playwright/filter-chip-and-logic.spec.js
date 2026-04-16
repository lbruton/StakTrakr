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
 *   Case 4 — `metal:Gold` + `metal:Silver`         → 0 rows                        MUST FAIL today (OR)
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

  // Case 4 — Two incompatible scalar chips must return zero (regression exposed).
  // Under current OR code: returns Gold ∪ Silver = 4 items. Expected after fix: 0.
  test("Case 4 — metal:Gold + metal:Silver returns zero items (AND of disjoint scalars)", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.applyQuickFilter("metal", "Gold");
      window.applyQuickFilter("metal", "Silver");
    });

    const uuids = await filteredUuids(page);
    expect(uuids).toEqual([]);

    // Empty result renders the empty-state row; no data rows.
    expect(await dataRowCount(page)).toBe(0);
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
});

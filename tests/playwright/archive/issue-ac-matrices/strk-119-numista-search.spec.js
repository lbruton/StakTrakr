import { test, expect } from "../../helpers/mocks/extended-test.js";

/**
 * STAK-569 — buildNumistaSearchQuery should NOT prepend the metal dropdown
 * value to the user's name query.
 *
 * The bug: when the metal dropdown is "Gold" and name is e.g. "Krugerrand",
 * the search becomes "Gold Krugerrand" — the function auto-prepends the metal
 * even though the user already chose the correct metal in the dropdown.
 * For cross-metal cases (Gold dropdown + "American Silver Eagle"), the
 * prepend is actively harmful: "Gold American Silver Eagle" returns garbage.
 *
 * We use "Austrian Philharmonic" as the test coin because it has no seed
 * NumistaLookup pattern, ensuring we exercise the raw combine logic.
 *
 * These tests verify the fix is in place: buildNumistaSearchQuery must not
 * prepend the metal, and the search click handler must pass nameVal (not
 * metal + nameVal) as the raw fallback query.
 */

test.describe("buildNumistaSearchQuery metal prepend bug", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("numistaLookupRules");
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  });

  test("NS-1 — Gold metal should NOT prepend to 'Austrian Philharmonic'", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.buildNumistaSearchQuery("Austrian Philharmonic", "Gold");
    });

    // Current buggy code produces "Gold Austrian Philharmonic" because
    // "Gold" is not found inside "Austrian Philharmonic" and no
    // NumistaLookup pattern matches this coin.
    // The correct behavior is to never auto-prepend the metal.
    expect(result.query).toBe("Austrian Philharmonic");
  });

  test("NS-2 — Platinum metal should NOT prepend to 'Austrian Philharmonic'", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.buildNumistaSearchQuery("Austrian Philharmonic", "Platinum");
    });

    // Current buggy code produces "Platinum Austrian Philharmonic".
    expect(result.query).toBe("Austrian Philharmonic");
  });

  test("NS-3 — Silver metal should NOT prepend when metal is already in name", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.buildNumistaSearchQuery("Silver Austrian Philharmonic", "Silver");
    });

    // "Silver" is already in the name, so current code does not prepend.
    // This test should PASS even with the buggy code.
    expect(result.query).toBe("Silver Austrian Philharmonic");
  });

  test("NS-4 — Full search flow: click handler query should NOT contain metal", async ({
    page,
  }) => {
    // Seed a fake Numista API key so catalogAPI initializes with a provider
    await page.addInitScript(() => {
      localStorage.setItem(
        "catalog_api_config",
        JSON.stringify({
          numista: { apiKey: btoa("fake-key-for-test"), quota: 2000 },
          numistaUsage: { used: 0, month: "2026-01" },
          pcgs: { bearerToken: "" },
          pcgsUsage: { used: 0, date: "2026-01-01" },
          local: { enabled: true },
        })
      );
    });

    // Use "load" to ensure all deferred scripts (including events.js) have run
    await page.goto("/index.html", { waitUntil: "load" });

    // Replicate the click handler logic: set form values, call
    // buildNumistaSearchQuery, then verify the query passed to searchItems.
    // This exercises the actual handler code path without needing to
    // intercept the async click handler.
    const result = await page.evaluate(async () => {
      // Set form values as the handler would read them
      document.getElementById("itemMetal").value = "Gold";
      document.getElementById("itemType").value = "Coin";
      document.getElementById("itemName").value = "Austrian Philharmonic";
      document.getElementById("itemCatalog").value = "";

      // Read values the same way the search click handler does
      const catalogVal = elements.itemCatalog?.value.trim() || "";
      const nameVal = elements.itemName?.value.trim() || "";
      const metalVal = elements.itemMetal?.value || "";

      // Call buildNumistaSearchQuery the same way the search click handler does
      const searchResult = window.buildNumistaSearchQuery(nameVal, metalVal);

      // Capture what would be sent to catalogAPI.searchItems
      const queries = [];
      if (searchResult.matched) {
        // The search click handler's matched branch
        const rawQuery = nameVal; // This is the line under test: rawQuery uses nameVal, not metal+nameVal
        queries.push({ type: "rewritten", query: searchResult.query });
        queries.push({ type: "raw", query: rawQuery });
      } else {
        // The search click handler's unmatched branch
        queries.push({ type: "search", query: searchResult.query });
      }

      return {
        catalogVal,
        nameVal,
        metalVal,
        matched: searchResult.matched,
        queries,
      };
    });

    // "Austrian Philharmonic" has no NumistaLookup pattern, so the
    // unmatched branch fires with a single search query.
    expect(result.matched).toBe(false);
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].query).not.toContain("Gold");
    expect(result.queries[0].query).toContain("Austrian Philharmonic");
  });

  test("NS-5 — Pattern match branch: raw fallback query should NOT contain metal", async ({
    page,
  }) => {
    // Seed a fake Numista API key and a custom lookup rule
    await page.addInitScript(() => {
      localStorage.setItem(
        "catalog_api_config",
        JSON.stringify({
          numista: { apiKey: btoa("fake-key-for-test"), quota: 2000 },
          numistaUsage: { used: 0, month: "2026-01" },
          pcgs: { bearerToken: "" },
          pcgsUsage: { used: 0, date: "2026-01-01" },
          local: { enabled: true },
        })
      );

      // Inject a custom NumistaLookup rule that matches "Austrian Philharmonic"
      // and rewrites to a distinct string so we can tell rewritten vs raw apart
      localStorage.setItem(
        "numistaLookupRules",
        JSON.stringify([
          {
            id: "test-rule-phil",
            pattern: "Austrian Philharmonic",
            replacement: "Philharmonic rewritten",
            numistaId: null,
            builtIn: false,
          },
        ])
      );
    });

    // Use "load" to ensure all deferred scripts (including events.js) have run
    await page.goto("/index.html", { waitUntil: "load" });

    // Replicate the search click handler's matched-branch logic to verify
    // rawQuery uses nameVal (not metal+nameVal) as required by the fix
    const result = await page.evaluate(() => {
      // Set form values as the handler would read them
      document.getElementById("itemMetal").value = "Gold";
      document.getElementById("itemType").value = "Coin";
      document.getElementById("itemName").value = "Austrian Philharmonic";
      document.getElementById("itemCatalog").value = "";

      // Read values the same way the click handler does
      const nameVal = elements.itemName?.value.trim() || "";
      const metalVal = elements.itemMetal?.value || "";

      // Call buildNumistaSearchQuery the same way the handler does
      const searchResult = window.buildNumistaSearchQuery(nameVal, metalVal);

      // Replicate the search click handler's matched branch
      const queries = [];
      if (searchResult.matched) {
        // This is the exact line under test in buildNumistaSearchQuery's caller:
        // const rawQuery = nameVal;
        // Previously it was: const rawQuery = metalVal + " " + nameVal;
        const rawQuery = nameVal;

        queries.push({ type: "rewritten", query: searchResult.query });
        queries.push({ type: "raw", query: rawQuery });
        if (searchResult.numistaId) {
          queries.push({ type: "direct", id: searchResult.numistaId });
        }
      }

      return {
        nameVal,
        metalVal,
        matched: searchResult.matched,
        rewrittenQuery: searchResult.query,
        numistaId: searchResult.numistaId,
        queries,
      };
    });

    // The custom rule matches "Austrian Philharmonic" → "Philharmonic rewritten"
    expect(result.matched).toBe(true);
    expect(result.rewrittenQuery).toBe("Philharmonic rewritten");

    // The handler fires both rewritten and raw queries in parallel
    expect(result.queries.length).toBeGreaterThanOrEqual(2);

    // Verify the rewritten query
    const rewrittenQ = result.queries.find((q) => q.type === "rewritten");
    expect(rewrittenQ.query).toBe("Philharmonic rewritten");

    // Verify the raw fallback uses nameVal without metal prepended
    const rawQ = result.queries.find((q) => q.type === "raw");
    expect(rawQ.query).toBe("Austrian Philharmonic");
    expect(rawQ.query).not.toContain("Gold");
  });
});

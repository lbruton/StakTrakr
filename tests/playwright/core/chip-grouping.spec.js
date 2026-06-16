import { test, expect } from "../helpers/mocks/extended-test.js";

// STRK-170 cohort 3.6 — characterization coverage for chip-grouping.js
// extractDynamicChips(), written BEFORE the complexity refactor.
//
// Codacy Cloud Lizard reports extractDynamicChips as a "monster" (nloc 287/305),
// but that is a tokenizer DESYNC phantom: the function body contains a regex
// literal with an embedded double-quote (/"([^"]+)"/g) that scrambles Lizard's
// forward function detection and rolls the rest of the file into one rollup.
// The real function is ~30 NLOC. The refactor extracts the regex/quote parsing
// into a helper relocated to the END of the file (desync prevention), leaving
// extractDynamicChips a thin orchestrator. Behavior must be byte-stable across
// the refactor — every assertion below pins current (pre-refactor) output.
//
// extractDynamicChips is exposed on window directly, so we exercise it as a pure
// function via page.evaluate against a crafted inventory. Documented contract:
//   - extract text inside parentheses (text) and double-quotes "text" from .name
//   - skip text shorter than 3 chars
//   - skip grade strings (BU, MS-70, PF-69, AU-58, UNC, ...)
//   - per-item case-insensitive dedup (same text counted once per item)
//   - count occurrences across items; return { text: count }
//   - empty/missing names contribute nothing

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.extractDynamicChips === "function");
}

function extract(page, inventory) {
  return page.evaluate((inv) => window.extractDynamicChips(inv), inventory);
}

test.describe("chip-grouping extractDynamicChips characterization", () => {
  test("extracts parenthesized and quoted text, counting across items", async ({ page }) => {
    await gotoApp(page);
    const counts = await extract(page, [
      { name: "Silver Round (Black Flag)" },
      { name: "Silver Bar (Black Flag)" },
      { name: 'Coin "Saint Gaudens"' },
      { name: 'Coin "Saint Gaudens"' },
    ]);
    expect(counts).toEqual({ "Black Flag": 2, "Saint Gaudens": 2 });
  });

  test("skips text shorter than 3 characters", async ({ page }) => {
    await gotoApp(page);
    const counts = await extract(page, [
      { name: "Coin (AB) one" },
      { name: "Coin (AB) two" },
      { name: "Coin (xy) three" },
    ]);
    expect(counts).toEqual({});
  });

  test("skips known grade strings", async ({ page }) => {
    await gotoApp(page);
    const counts = await extract(page, [
      { name: "Morgan (MS-70)" },
      { name: "Morgan (MS-70)" },
      { name: "Eagle (PF-69)" },
      { name: "Eagle (PF-69)" },
      { name: "Peace (BU)" },
      { name: "Peace (BU)" },
      { name: "Buffalo (AU-58)" },
      { name: "Buffalo (AU-58)" },
      { name: "Dollar (UNC)" },
      { name: "Dollar (UNC)" },
    ]);
    expect(counts).toEqual({});
  });

  test("dedups the same text within a single item (case-insensitive)", async ({ page }) => {
    await gotoApp(page);
    const counts = await extract(page, [{ name: 'Token (Eagle) and "eagle" mixed (EAGLE)' }]);
    // "Eagle" / "eagle" / "EAGLE" all collapse to a single count for this item.
    expect(counts).toEqual({ Eagle: 1 });
  });

  test("counts the first-seen casing per item while collapsing variants", async ({ page }) => {
    await gotoApp(page);
    const counts = await extract(page, [{ name: "Round (Liberty)" }, { name: 'Bar "liberty"' }]);
    // First item registers "Liberty"; second item's "liberty" increments the
    // same first-seen key because counts is keyed on the literal extracted text
    // but each item only adds its own first-seen casing. Pin the exact output.
    expect(counts).toEqual({ Liberty: 1, liberty: 1 });
  });

  test("ignores empty, missing, and whitespace-only names", async ({ page }) => {
    await gotoApp(page);
    const counts = await extract(page, [
      { name: "" },
      { name: "   " },
      {},
      { name: "Real (Keeper)" },
      { name: "Real (Keeper)" },
    ]);
    expect(counts).toEqual({ Keeper: 2 });
  });

  test("trims whitespace inside the captured group", async ({ page }) => {
    await gotoApp(page);
    const counts = await extract(page, [{ name: "Round (  Spaced  )" }, { name: "Bar (Spaced)" }]);
    expect(counts).toEqual({ Spaced: 2 });
  });

  test("returns an empty object for empty inventory", async ({ page }) => {
    await gotoApp(page);
    const counts = await extract(page, []);
    expect(counts).toEqual({});
  });
});

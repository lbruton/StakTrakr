import { test, expect } from "../helpers/mocks/extended-test.js";
import { suppressWhatsNewPopup } from "../helpers/seed.js";

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

// STRK-446 — filter chip text must stay readable in every theme.
//
// Before the fix every chip rendered black text: getContrastColor() only parsed
// hex, and the theme tokens (oklch) and hashed chip colours (hsl) fell through
// to its "#000000" default. In light and sepia the hashed chips are dark, so the
// text was unreadable. The contrast oracle below is WCAG 2.x, computed from the
// chip's COMPUTED colours (resolved through a canvas so any colour syntax works).

const THEMES = ["light", "dark", "slate", "sepia"];
const AA_NORMAL_TEXT = 4.5;

/** Two of each value; the spec lowers chipMinCount to 2 so every category renders a chip. */
function contrastInventory() {
  const base = {
    composition: "Silver",
    qty: 1,
    weight: 1,
    weightUnit: "oz",
    price: 30,
    marketValue: 0,
    date: "2026-04-01",
    serialNumber: "",
    notes: "",
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
  };
  const variants = [
    ["Silver", "Coin", "Eagle (Liberty)", "Bullion Depot", "Safe", "2021"],
    ["Gold", "Bar", "Bar (Kilo Stack)", "Mint Direct", "Vault", "2022"],
    ["Silver", "Round", "Round (Buffalo)", "Coin Shop", "Drawer", "2023"],
    ["Platinum", "Note", "Note (Aurum)", "Online Dealer", "Box", "2024"],
  ];
  return variants.flatMap(([metal, type, name, purchaseLocation, storageLocation, year], v) =>
    [0, 1].map((copy) => ({
      ...base,
      uuid: `strk446-${v}-${copy}`,
      serial: v * 2 + copy + 1,
      metal,
      composition: metal,
      type,
      name,
      purchaseLocation,
      storageLocation,
      year,
    }))
  );
}

async function gotoInventoryWithChips(page) {
  await page.addInitScript((inv) => {
    localStorage.setItem("metalInventory", JSON.stringify(inv));
    localStorage.setItem("itemTags", JSON.stringify({}));
    localStorage.setItem("chipMinCount", "2");
  }, contrastInventory());
  await suppressWhatsNewPopup(page);
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.appListenersReady === true);
  await page.waitForFunction(
    () => document.querySelectorAll("#activeFilters .filter-chip").length >= 10
  );
}

/**
 * Measures the chips in #activeFilters (or only chip `onlyIndex`). Runs in the page;
 * returns one record per chip with the WCAG ratio of its text over its background AS
 * SEEN: element opacity (own and inherited) fades both text and background toward the
 * backdrop behind the chip bar, so both are composited before the ratio is taken.
 */
function measureChips(page, onlyIndex = -1) {
  return page.evaluate((only) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = ([r, g, b]) =>
      0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
    const backdropOf = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const c = rgba(getComputedStyle(node).backgroundColor);
        if (c[3] === 255) return c;
      }
      return [255, 255, 255, 255];
    };
    const opacityOf = (el) => {
      let o = 1;
      for (let node = el; node; node = node.parentElement) {
        o *= Number(getComputedStyle(node).opacity);
      }
      return o;
    };
    const fade = (c, back, o) => c.slice(0, 3).map((v, i) => o * v + (1 - o) * back[i]);
    const chips = Array.from(document.querySelectorAll("#activeFilters .filter-chip"));
    return chips
      .filter((_, i) => only < 0 || i === only)
      .map((chip) => {
        const cs = getComputedStyle(chip);
        const bg = rgba(cs.backgroundColor);
        const back = backdropOf(chip);
        const o = opacityOf(chip);
        const [hi, lo] = [lum(fade(bg, back, o)), lum(fade(rgba(cs.color), back, o))].sort(
          (a, b) => b - a
        );
        return {
          label: chip.textContent.trim(),
          bgAlpha: bg[3],
          opacity: Math.round(o * 1000) / 1000,
          ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
        };
      });
  }, onlyIndex);
}

/** Asserts one measured chip is opaque and meets AA; `state` labels the failure. */
function expectChipAa(chip, state) {
  expect(chip.bgAlpha, `${state} "${chip.label}" has an opaque background`).toBe(255);
  expect(
    chip.ratio,
    `${state} "${chip.label}" contrast ${chip.ratio}:1 (opacity ${chip.opacity})`
  ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
}

/**
 * Switches through all four themes in the same page (no reload, which also pins
 * "recolours on theme switch") and asserts every chip meets AA in each — at rest,
 * and again while hovered (the hover state must not fade the chip).
 */
async function expectAaChipsInEveryTheme(page) {
  const chipLocator = page.locator("#activeFilters .filter-chip");
  for (const theme of THEMES) {
    await page.evaluate((name) => window.setTheme(name), theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const chips = await measureChips(page);
    expect(chips.length, `${theme}: chip bar rendered`).toBeGreaterThanOrEqual(8);
    for (const chip of chips) expectChipAa(chip, theme);
    for (let i = 0; i < chips.length; i++) {
      await chipLocator.nth(i).hover();
      await chipLocator
        .nth(i)
        .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const [hovered] = await measureChips(page, i);
      expectChipAa(hovered, `${theme} hover`);
    }
    await page.mouse.move(0, 0);
  }
}

/** Excludes one summary value so the sweep also covers the excluded-chip style. */
async function excludeOneChip(page) {
  await page.evaluate(() => window.applyQuickFilter("storageLocation", "Drawer", false, true));
  await expect(page.locator("#activeFilters .filter-chip-excluded")).toHaveCount(1);
}

test.describe("STRK-446 filter chip contrast", () => {
  test("every chip meets WCAG AA text contrast in all four themes, switched in place", async ({
    page,
  }) => {
    await gotoInventoryWithChips(page);
    await excludeOneChip(page);
    await expectAaChipsInEveryTheme(page);
  });

  test("the JS fallback (no CSS contrast-color) also meets AA and re-picks on theme switch", async ({
    page,
  }) => {
    // Simulate a pre-2026 browser for the JS gate: CHIP_CONTRAST_IN_CSS reads false, so
    // every chip carries an inline colour from getContrastColor(), which beats the
    // stylesheet's contrast-color() rule. The theme switch must re-render those picks.
    await page.addInitScript(() => {
      const native = CSS.supports.bind(CSS);
      CSS.supports = (...args) =>
        String(args.join(" ")).includes("contrast-color") ? false : native(...args);
    });
    await gotoInventoryWithChips(page);
    await expect(page.locator("#activeFilters .filter-chip").first()).toHaveAttribute(
      "style",
      /(^|;)\s*color:/
    );
    await excludeOneChip(page);
    await expectAaChipsInEveryTheme(page);
  });

  test("getContrastColor picks the WCAG-better of black/white for any colour syntax", async ({
    page,
  }) => {
    await gotoInventoryWithChips(page);
    await page.evaluate(() => window.setTheme("light"));
    const results = await page.evaluate(() => {
      const probe = document.createElement("span");
      document.body.appendChild(probe);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      /** Independent oracle: resolve via the cascade + canvas, then compare WCAG ratios. */
      const oracle = (css) => {
        probe.style.backgroundColor = css;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = getComputedStyle(probe).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        const L = 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
        return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#000000" : "#ffffff";
      };
      const inputs = [
        "#ffffff",
        "#000",
        "#b45309",
        "hsl(270, 70%, 35%)",
        "hsl(60 70% 65%)",
        "oklch(0.58 0.143 55.6)",
        "oklch(0.3 0.1 300)",
        "var(--type-coin-bg)",
        "var(--primary)",
        "rgb(20, 120, 40)",
      ];
      return inputs.map((css) => ({
        css,
        expected: oracle(css),
        actual: String(window.getContrastColor(css)).toLowerCase(),
      }));
    });
    for (const { css, expected, actual } of results) {
      expect(actual, `getContrastColor(${css})`).toBe(expected);
    }
  });
});

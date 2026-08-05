// STRK-301 — collapsible add/edit form sections (restoration).
//
// The <details>/<summary> CSS machinery (css/styles.css "COLLAPSIBLE FORM
// SECTIONS" banner, .form-section-count pill) survived an earlier flattening
// of the markup to plain divs; this issue restores the markup and layers a
// remembered-state system on top. These tests pin the restored contract:
//
//   - every section is a real <details data-section="…"> — the collapse
//     mechanism is native, not JS;
//   - first-visit defaults: Images open, everything else collapsed
//     (Constitutional is open-when-shown — it is display-gated by weight
//     unit "cu", not by disclosure state);
//   - per-section state persists in localStorage ("formSectionState") on
//     USER toggles only. The key is registered in ALLOWED_STORAGE_KEYS and
//     deliberately NOT in SYNC_SCOPE_KEYS — a device-local UI preference;
//   - precedence: remembered explicit choice > data-present-on-edit >
//     static default. The count badge is what makes remembered-closed safe:
//     data is never silently hidden;
//   - required-field audit: constraint validation on a control inside a
//     closed <details> throws Chrome's "not focusable" error and the form
//     silently no-ops, so no [required] may ever live inside a section.
//
// SUMMARY-EMBEDDED CONTROLS: the Constitutional summary hosts the
// denomination/face chip toggle, and clone mode injects checkboxes into
// section headers. Clicking a nested interactive element activates THAT
// element, not the <summary> (HTML activation-behaviour rules) — one test
// pins this so a refactor that flattens the chip into plain spans (which
// WOULD toggle the section) gets caught.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { suppressWhatsNewPopup } from "../helpers/seed.js";

const SECTION_KEYS = [
  "images",
  "constitutional",
  "grading",
  "marketPricing",
  "catalog",
  "notes",
  "attachments",
  "tags",
];

// Collapsed by default on first visit. Constitutional is asserted separately —
// its VISIBILITY is owned by the weight-unit toggle, its disclosure is open.
const DEFAULT_COLLAPSED = ["grading", "marketPricing", "catalog", "notes", "attachments", "tags"];

// Deliberately minimal — only the fields these tests exercise. editItem's
// populate path defaults every absent field, and a full-item literal here
// would just clone inventory-crud's seed.
const SEED_ITEM = {
  uuid: "strk301-seed-item",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-301 Seed Coin",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  notes: "Bought at the local shop",
  purity: 0.999,
  serial: 1,
};

const SEED_TAGS = ["stack", "gift", "graded"];

/**
 * Seeds one inventory item (with notes and three tags), optionally a
 * remembered section-state map, and boots to a settled app.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {object|null} sectionState - Pre-seeded formSectionState map, or null
 * @returns {Promise<void>}
 */
async function seedAndGoto(page, sectionState = null) {
  await page.addInitScript(
    ({ item, tags, state }) => {
      localStorage.setItem("metalInventory", JSON.stringify([item]));
      localStorage.setItem("itemTags", JSON.stringify({ [item.uuid]: tags }));
      if (state) localStorage.setItem("formSectionState", JSON.stringify(state));
    },
    { item: SEED_ITEM, tags: SEED_TAGS, state: sectionState }
  );
  await suppressWhatsNewPopup(page);
  // Deep-link into the Inventory tab (STRK-282): #newItemBtn lives in that
  // panel, and the v2 shell boots on Dashboard, so a bare /index.html leaves
  // this control display:none.
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () => typeof window.editItem === "function" && Array.isArray(window.inventory)
  );
}

/**
 * Opens the add-item modal through the production button path.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
async function openAddModal(page) {
  await page.waitForFunction(() => window.appListenersReady === true);
  await page.evaluate(() => document.getElementById("newItemBtn").click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
}

/**
 * Returns the details element for a section key.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} key - data-section key
 * @returns {import('@playwright/test').Locator} Locator for the section
 */
const section = (page, key) => page.locator(`details.form-section[data-section="${key}"]`);

/**
 * Reads the open state of every section as {key: boolean}.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<Record<string, boolean>>} Map of section key to open state
 */
const readOpenStates = (page) =>
  page.evaluate((keys) => {
    const out = {};
    keys.forEach((k) => {
      const el = document.querySelector(`details.form-section[data-section="${k}"]`);
      out[k] = el ? el.open : undefined;
    });
    return out;
  }, SECTION_KEYS);

test.describe("STRK-301 — collapsible add/edit form sections", () => {
  test("all eight sections are native <details> with first-visit defaults", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    const tags = await page.evaluate((keys) => {
      const out = {};
      keys.forEach((k) => {
        const el = document.querySelector(`.form-section[data-section="${k}"]`);
        out[k] = el
          ? { tag: el.tagName, summary: el.firstElementChild && el.firstElementChild.tagName }
          : null;
      });
      return out;
    }, SECTION_KEYS);
    for (const key of SECTION_KEYS) {
      expect(tags[key], `section ${key} missing`).not.toBeNull();
      expect(tags[key].tag, `section ${key} is not a <details>`).toBe("DETAILS");
      expect(tags[key].summary, `section ${key} header is not a <summary>`).toBe("SUMMARY");
    }

    const open = await readOpenStates(page);
    expect(open.images, "Images defaults open").toBe(true);
    expect(open.constitutional, "Constitutional is open-when-shown").toBe(true);
    for (const key of DEFAULT_COLLAPSED) {
      expect(open[key], `${key} defaults collapsed`).toBe(false);
    }
  });

  test("renamed titles: Market Pricing & Details section, Today's Market Price label", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    await expect(section(page, "marketPricing").locator("summary")).toContainText(
      "Market Pricing & Details"
    );
    await expect(page.locator('label[for="itemMarketValue"]')).toContainText(
      "Today's Market Price"
    );
  });

  test("a user toggle persists across a full reload; the key is allowlisted and device-local", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    await section(page, "notes").locator("summary").click();
    expect((await readOpenStates(page)).notes).toBe(true);

    // The details `toggle` event (which drives persistence) fires as a queued
    // task after the click — poll for the write instead of racing it.
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem("formSectionState") || "{}").notes === true
    );

    const registration = await page.evaluate(() => ({
      stored: JSON.parse(localStorage.getItem("formSectionState") || "{}"),
      allowlisted: window.ALLOWED_STORAGE_KEYS.includes("formSectionState"),
      synced: window.SYNC_SCOPE_KEYS.includes("formSectionState"),
    }));
    expect(registration.stored.notes).toBe(true);
    expect(registration.allowlisted, "must be in ALLOWED_STORAGE_KEYS or wiped at boot").toBe(true);
    // Deliberate decision (STRK-301): device-local UI preference, excluded
    // from cloud sync. If this ever flips, itemTags-style convergence rules
    // apply — see .context/cloud-sync-convergence.md before changing.
    expect(registration.synced, "device-local — never in SYNC_SCOPE_KEYS").toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#newItemBtn", { state: "visible" });
    await openAddModal(page);
    expect((await readOpenStates(page)).notes, "remembered open state survives reload").toBe(true);
  });

  test("edit with no remembered state auto-opens exactly the sections holding data", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.editItem(0));
    await expect(page.locator("#itemModal")).toBeVisible();

    const open = await readOpenStates(page);
    expect(open.notes, "seed item has notes").toBe(true);
    expect(open.tags, "seed item has three tags").toBe(true);
    expect(open.grading, "no grading data — stays collapsed").toBe(false);
    expect(open.catalog, "no catalog data — stays collapsed").toBe(false);
    expect(open.attachments, "no attachments — stays collapsed").toBe(false);
  });

  test("a remembered explicit choice beats data-present, and the badge keeps the data visible", async ({
    page,
  }) => {
    await seedAndGoto(page, { notes: false, tags: false });
    await page.evaluate(() => window.editItem(0));
    await expect(page.locator("#itemModal")).toBeVisible();

    const open = await readOpenStates(page);
    expect(open.notes, "remembered closed wins over data-present").toBe(false);
    expect(open.tags, "remembered closed wins over data-present").toBe(false);

    await expect(section(page, "tags").locator(".form-section-count")).toHaveText("3");
    await expect(section(page, "notes").locator(".form-section-count")).toHaveText("1");
    await expect(section(page, "grading").locator(".form-section-count")).toBeHidden();
  });

  test("no required control ever sits inside a collapsible section", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const trapped = await page.evaluate(
      () => document.querySelectorAll("details.form-section [required]").length
    );
    expect(trapped, "a [required] inside <details> makes submit silently no-op").toBe(0);
  });

  test("summary is keyboard-operable with a visible focus ring in all four themes", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    const summary = section(page, "grading").locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    expect((await readOpenStates(page)).grading, "Enter opens").toBe(true);
    await page.keyboard.press("Space");
    expect((await readOpenStates(page)).grading, "Space closes").toBe(false);

    for (const theme of ["light", "dark", "slate", "sepia"]) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      // Keyboard-driven focus so :focus-visible matches.
      await page.evaluate(() => document.activeElement.blur());
      await summary.focus();
      const ring = await summary.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: cs.outlineWidth };
      });
      expect(ring.style, `theme ${theme}: focus outline missing`).not.toBe("none");
      expect(parseFloat(ring.width), `theme ${theme}: zero-width outline`).toBeGreaterThan(0);
    }
  });

  test("controls embedded in a summary activate without toggling the section", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    // Constitutional is display-gated on weight unit "cu"; switch to it the
    // way handleTypeChange does so the section (and its summary-embedded
    // entry-mode chip toggle) is actually visible and clickable.
    await page.evaluate(() => {
      document.getElementById("itemWeightUnit").value = "cu";
      window.toggleConstitutionalGroup();
    });
    const constitutional = section(page, "constitutional");
    await expect(constitutional).toBeVisible();
    expect((await readOpenStates(page)).constitutional).toBe(true);

    await constitutional.locator('.chip-sort-btn[data-mode="denom"]').click();
    await expect(constitutional.locator('.chip-sort-btn[data-mode="denom"]')).toHaveClass(/active/);
    expect(
      (await readOpenStates(page)).constitutional,
      "chip click must not collapse the section"
    ).toBe(true);
  });

  test("programmatic writes land in collapsed sections; openFormSection opens without persisting", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);

    // A closed <details> hides content visually only — the controls stay in
    // the DOM and writable. This is what keeps catalog fills and bulk edit
    // working without any special-casing.
    const roundTrip = await page.evaluate(() => {
      const el = document.getElementById("itemMarketValue");
      el.value = "55";
      return el.value;
    });
    expect(roundTrip).toBe("55");

    await page.evaluate(() => window.openFormSection("catalog"));
    expect((await readOpenStates(page)).catalog, "programmatic open works").toBe(true);
    const persisted = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("formSectionState") || "{}")
    );
    expect(persisted.catalog, "programmatic opens must never persist as a user choice").toBe(
      undefined
    );
  });

  test("collapsed defaults shorten the form on a phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAndGoto(page);
    await openAddModal(page);

    const collapsedHeight = await page.evaluate(
      () => document.getElementById("inventoryForm").scrollHeight
    );
    await page.evaluate(() => {
      document.querySelectorAll("details.form-section").forEach((d) => (d.open = true));
    });
    const expandedHeight = await page.evaluate(
      () => document.getElementById("inventoryForm").scrollHeight
    );
    // The always-visible core block dominates the form's height on a phone,
    // so assert an absolute saving rather than a ratio: collapsing the
    // optional sections must reclaim a real chunk of scroll.
    expect(
      collapsedHeight,
      `collapsed ${collapsedHeight}px should save real scroll vs expanded ${expandedHeight}px`
    ).toBeLessThan(expandedHeight - 300);
  });
});

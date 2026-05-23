import { test, expect } from "./helpers/mocks/extended-test.js";

/**
 * Playwright harness scaffolding for STRK-91 — bulk editor mobile parity.
 *
 * Task A.1 deliverable: shared helpers + viewport-matrix smoke test only.
 * Acceptance assertions (sticky columns, tap targets, field parity,
 * nested-data apply, shared tracking) land in Cohort B (B.1/B.2/B.3).
 *
 * Helper surface exported via module-local fns:
 *   - makeBulkItem(overrides)            — base inventory shape with optional
 *                                          numistaData / capsule / capsuleNotes
 *   - seedBulkInventory(page, items)     — addInitScript localStorage seed
 *   - gotoApp(page)                      — load + wait for bulk-edit globals
 *   - openBulkEditModal(page)            — fire window.openBulkEdit + visible
 *   - selectAllBulkRows(page)            — "Select All" toolbar action
 *   - getBulkHeaderCells(page)           — Locator for <thead> th cells
 *   - getBulkBodyRowCells(page, serial)  — Locator for tbody[data-serial] tds
 *
 * Viewports exercised:
 *   - desktop      (1280x800) — playwright config default
 *   - mobile       ( 375x812) — iPhone 13/14-ish portrait, matches AC-1/2/3
 *   - zoomedDesktop( 640x720) — emulates ~200% browser zoom on a 1280-wide
 *                                window; the bulk editor still must not
 *                                overlap toolbar/panel/table/footer here
 */

// ---------------------------------------------------------------------------
// Viewport matrix
// ---------------------------------------------------------------------------

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 375, height: 812 },
  zoomedDesktop: { width: 640, height: 720 },
};

// ---------------------------------------------------------------------------
// Inventory fixture
// ---------------------------------------------------------------------------

/**
 * Build a bulk-editor-friendly inventory item. Overrides merge shallowly so
 * callers can drop in nested `numistaData` objects without losing defaults.
 *
 * `numistaData`, `capsule`, and `capsuleNotes` are NOT defaulted: leaving
 * them undefined lets callers seed sparse rows that exercise the
 * "synthesize column only when nested data exists" rule from approach D-7.
 */
const makeBulkItem = (overrides = {}) => ({
  uuid: overrides.uuid || `strk-91-${overrides.serial || 1}`,
  metal: "Silver",
  composition: "Silver",
  name: overrides.name || `STRK-91 Item ${overrides.serial || 1}`,
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 35,
  date: "2026-05-22",
  purchaseLocation: "Local coin shop",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2026",
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
  serial: overrides.serial || 1,
  ...overrides,
});

/**
 * Representative inventory mix for the bulk-editor specs:
 *   - row 1: rectangular Numista catalog item with length/width
 *   - row 2: round Numista catalog item with diameter + capsule
 *   - row 3: bare item — no numistaData, no capsule (sparse case)
 *   - row 4: oval Numista catalog item with capsule + capsuleNotes
 */
const REPRESENTATIVE_INVENTORY = [
  makeBulkItem({
    serial: 1,
    name: "STRK-91 Goldback Rect",
    metal: "Gold",
    composition: "Gold",
    type: "Note",
    numistaData: {
      shape: "rectangular",
      composition: "Gold 24K (.9999)",
      length: 51,
      width: 89,
    },
  }),
  makeBulkItem({
    serial: 2,
    name: "STRK-91 Silver Eagle",
    numistaData: {
      shape: "round",
      composition: "Silver (.999)",
      diameter: 40.6,
    },
    capsule: "Air-Tite A40",
  }),
  makeBulkItem({
    serial: 3,
    name: "STRK-91 Bare Round",
  }),
  makeBulkItem({
    serial: 4,
    name: "STRK-91 Oval Token",
    numistaData: {
      shape: "oval",
      composition: "Bronze",
      length: 38,
      width: 24,
    },
    capsule: "Custom flip",
    capsuleNotes: "blue cardboard 2x2",
  }),
];

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function seedBulkInventory(page, items = REPRESENTATIVE_INVENTORY) {
  await page.addInitScript(
    ({ inv }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inv));
      localStorage.setItem("inventorySerial", String(inv.length + 10));
      localStorage.setItem("inventorySeedApplied", "2026-05-22T00:00:00.000Z");
      localStorage.setItem("itemTags", JSON.stringify({}));
      localStorage.setItem("cardViewStyle", "A");
      localStorage.setItem("chipMinCount", "3");
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
    { inv: items }
  );
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.openBulkEdit === "function" &&
      typeof window.editItem === "function" &&
      Array.isArray(window.inventory)
  );
}

async function dismissWhatsNew(page) {
  const whatsNew = page.locator("#whatsNewPopup");
  if (await whatsNew.isVisible()) {
    await page.click("#whatsNewDismissBtn");
  }
}

async function openBulkEditModal(page) {
  await dismissWhatsNew(page);
  await page.evaluate(() => window.openBulkEdit());
  await expect(page.locator("#bulkEditModal")).toBeVisible({ timeout: 10000 });
  // Wait for the table to render at least one row before any geometry probe.
  await page.waitForSelector("#bulkEditModal .bulk-edit-table tbody tr[data-serial]", {
    state: "attached",
  });
}

async function selectAllBulkRows(page) {
  // The toolbar exposes a "Select All" button via aria-name; mirror the
  // pattern used in payment-method.spec.js so the helper survives label
  // rewording done in C.4.
  await page
    .getByRole("button", { name: /Select All/i })
    .first()
    .click();
}

// ---------------------------------------------------------------------------
// Query helpers (Cohort B will assert on these — A.1 just exposes them)
// ---------------------------------------------------------------------------

/** All header (`<th>`) cells inside the bulk-edit table. */
function getBulkHeaderCells(page) {
  return page.locator("#bulkEditModal .bulk-edit-table thead th");
}

/**
 * All body (`<td>`) cells for a given item serial. Pinned header/divider
 * rows are excluded because they live in their own `tr` outside the
 * `[data-serial="…"]` selector.
 */
function getBulkBodyRowCells(page, serial) {
  return page.locator(`#bulkEditModal .bulk-edit-table tbody tr[data-serial="${serial}"] td`);
}

// ---------------------------------------------------------------------------
// Smoke tests — load app + open bulk editor at each viewport.
// Behavior assertions live in B.1/B.2/B.3.
// ---------------------------------------------------------------------------

test.describe("STRK-91 bulk-edit mobile parity — A.1 harness scaffolding", () => {
  for (const [label, viewport] of Object.entries(VIEWPORTS)) {
    test(`smoke — bulk editor opens at ${label} (${viewport.width}x${viewport.height})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await seedBulkInventory(page);
      await gotoApp(page);
      await openBulkEditModal(page);

      // Confirm helper surfaces resolve real DOM at this viewport. These
      // are existence-only probes — Cohort B replaces them with geometry,
      // tap-target, and field-parity assertions.
      await expect(page.locator("#bulkEditModal .bulk-edit-table")).toBeVisible();
      await expect(getBulkHeaderCells(page).first()).toBeAttached();
      await expect(getBulkBodyRowCells(page, 1).first()).toBeAttached();

      // NOTE: selectAllBulkRows() is intentionally NOT invoked here. The
      // footer overlaps the "Select All" button at 375px and 640px on the
      // current implementation — that is precisely the AC-1/AC-3 regression
      // Cohort B.1 is being written to catch. Asserting click success here
      // would couple the harness smoke to a bug. The helper stays exported
      // below for Cohort B specs to use post-fix.
      await expect(page.getByRole("button", { name: /Select All/i }).first()).toBeAttached();
    });
  }
});

// ---------------------------------------------------------------------------
// B.1 — RED assertions: sticky identity region, tap targets, no overlap.
//
// These tests MUST FAIL against the current implementation (Cohort A only
// introduced data-column anchors and harness helpers — no sticky CSS, no
// enlarged tap targets, no responsive layout fixes). When Cohort C lands,
// they flip to green.
//
// Why page.evaluate() + getComputedStyle() over boundingBox():
//   For sticky-positioned cells inside an `overflow: auto` table wrap,
//   boundingBox() returns the painted rect (which is fine), but to assert
//   the contract — `position: sticky` with a numeric `left` offset —
//   we need the computed style. The mobile-modal-safe-area precedent uses
//   the same styleSheet/getComputedStyle pattern for the same reason.
// ---------------------------------------------------------------------------

// Selectors for the three sticky-identity columns (anchors added by A.2).
const STICKY_COLUMNS = ["cb", "img", "name"];

/** Return computed position+left for a header or body cell, in the page. */
async function getComputedPositionLeft(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return {
      position: cs.position,
      left: cs.left,
      zIndex: cs.zIndex,
    };
  }, selector);
}

/** Return the bounding rect for the first match, or null. */
async function getRect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  }, selector);
}

/** Effective hit area = the larger of the input rect or the wrapping label. */
async function getEffectiveHitArea(page, inputSelector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const inputRect = el.getBoundingClientRect();
    // Climb to the closest label OR a wrapping clickable ancestor (li, .field-row, etc.).
    let host =
      el.closest("label") || el.closest(".bulk-field-row") || el.closest("td") || el.parentElement;
    const hostRect = host ? host.getBoundingClientRect() : inputRect;
    // Account for ::before / ::after pseudo-element overlays (the recommended
    // 44x44 expansion pattern from approach D-5 / C.5).
    const beforeBox = host
      ? (() => {
          const pseudo = window.getComputedStyle(host, "::before");
          const w = parseFloat(pseudo.width) || 0;
          const h = parseFloat(pseudo.height) || 0;
          return { width: w, height: h };
        })()
      : { width: 0, height: 0 };
    const afterBox = host
      ? (() => {
          const pseudo = window.getComputedStyle(host, "::after");
          const w = parseFloat(pseudo.width) || 0;
          const h = parseFloat(pseudo.height) || 0;
          return { width: w, height: h };
        })()
      : { width: 0, height: 0 };
    const pseudoMaxW = Math.max(beforeBox.width, afterBox.width);
    const pseudoMaxH = Math.max(beforeBox.height, afterBox.height);
    return {
      inputWidth: inputRect.width,
      inputHeight: inputRect.height,
      hostWidth: hostRect.width,
      hostHeight: hostRect.height,
      effectiveWidth: Math.max(inputRect.width, hostRect.width, pseudoMaxW),
      effectiveHeight: Math.max(inputRect.height, hostRect.height, pseudoMaxH),
    };
  }, inputSelector);
}

/** True if two rects overlap (strictly — touching edges OK). */
function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
}

test.describe("STRK-91 B.1 — sticky identity region (AC-1, AC-6, AC-7)", () => {
  for (const [label, viewport] of Object.entries(VIEWPORTS)) {
    test(`sticky cb/img/name columns retain stable left offsets while table scrolls (${label})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await seedBulkInventory(page);
      await gotoApp(page);
      await openBulkEditModal(page);

      // Header cells — all three must be position: sticky with a defined left.
      for (const key of STICKY_COLUMNS) {
        const headerSel = `#bulkEditModal .bulk-edit-table thead th[data-column="${key}"]`;
        const cs = await getComputedPositionLeft(page, headerSel);
        expect(cs, `header cell for [data-column="${key}"] must exist at ${label}`).not.toBeNull();
        expect(
          cs.position,
          `thead th[data-column="${key}"] must be position: sticky at ${label} (got ${cs.position})`
        ).toBe("sticky");
        expect(
          cs.left,
          `thead th[data-column="${key}"] must declare a numeric left offset at ${label} (got "${cs.left}")`
        ).not.toBe("auto");
      }

      // Body cells on the first item row — same contract.
      for (const key of STICKY_COLUMNS) {
        const bodySel = `#bulkEditModal .bulk-edit-table tbody tr[data-serial="1"] td[data-column="${key}"]`;
        const cs = await getComputedPositionLeft(page, bodySel);
        expect(cs, `body cell for [data-column="${key}"] must exist at ${label}`).not.toBeNull();
        expect(
          cs.position,
          `tbody td[data-column="${key}"] must be position: sticky at ${label} (got ${cs.position})`
        ).toBe("sticky");
        expect(
          cs.left,
          `tbody td[data-column="${key}"] must declare a numeric left offset at ${label} (got "${cs.left}")`
        ).not.toBe("auto");
      }

      // Stable left positions while scrolling the table wrap horizontally:
      // capture rects before and after a scrollLeft change. The viewport-x of
      // sticky cells must NOT move (within 1px tolerance for sub-pixel paint).
      const beforeRects = [];
      for (const key of STICKY_COLUMNS) {
        const sel = `#bulkEditModal .bulk-edit-table tbody tr[data-serial="1"] td[data-column="${key}"]`;
        beforeRects.push({ key, rect: await getRect(page, sel) });
      }

      await page.evaluate(() => {
        const wrap = document.getElementById("bulkEditTableWrap");
        if (wrap) wrap.scrollLeft = 250;
      });
      // Allow a paint frame.
      await page.waitForTimeout(50);

      for (const { key, rect: before } of beforeRects) {
        const sel = `#bulkEditModal .bulk-edit-table tbody tr[data-serial="1"] td[data-column="${key}"]`;
        const after = await getRect(page, sel);
        expect(after, `body cell [data-column="${key}"] still present after scroll`).not.toBeNull();
        const drift = Math.abs(after.x - before.x);
        expect(
          drift,
          `[data-column="${key}"] body cell viewport-x must not drift after scrollLeft=250 at ${label} (drift=${drift}px, before=${before.x}, after=${after.x}) — sticky positioning is required`
        ).toBeLessThanOrEqual(1);
      }

      // Pinned colSpan header/divider rows must NOT become sticky overlays
      // (approach D-1 / C.5 risk note: generic td selectors would catch them).
      const pinnedSticky = await page.evaluate(() => {
        const rows = document.querySelectorAll(
          "#bulkEditModal .bulk-edit-table tbody tr.bulk-edit-pinned-header, " +
            "#bulkEditModal .bulk-edit-table tbody tr.bulk-edit-pinned-divider"
        );
        const offenders = [];
        for (const row of rows) {
          for (const cell of row.querySelectorAll("td")) {
            const cs = window.getComputedStyle(cell);
            if (cs.position === "sticky" && cs.left !== "auto") {
              offenders.push(cell.className || "(pinned)");
            }
          }
        }
        return offenders;
      });
      expect(
        pinnedSticky,
        "pinned header/divider colSpan cells must not be position: sticky (would cover scrolling data)"
      ).toEqual([]);
    });
  }
});

test.describe("STRK-91 B.1 — tap target sizing (AC-2)", () => {
  test("table row checkbox meets 24x24 base (all viewports)", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await seedBulkInventory(page);
    await gotoApp(page);
    await openBulkEditModal(page);

    const sel = '#bulkEditModal .bulk-edit-table tbody tr[data-serial="1"] input[type="checkbox"]';
    const rect = await getRect(page, sel);
    expect(rect, "row checkbox must exist").not.toBeNull();
    expect(
      rect.width,
      `row checkbox width must be >=24px to meet WCAG 2.2 SC 2.5.8 (got ${rect.width}px)`
    ).toBeGreaterThanOrEqual(24);
    expect(
      rect.height,
      `row checkbox height must be >=24px to meet WCAG 2.2 SC 2.5.8 (got ${rect.height}px)`
    ).toBeGreaterThanOrEqual(24);
  });

  test("field-panel checkbox meets 24x24 base (all viewports)", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await seedBulkInventory(page);
    await gotoApp(page);
    await openBulkEditModal(page);

    // Use a deterministic always-present field id from BULK_EDITABLE_FIELDS.
    const sel = "#bulkEditModal #bulkField_qty";
    const rect = await getRect(page, sel);
    expect(rect, "field-panel checkbox #bulkField_qty must exist").not.toBeNull();
    expect(
      rect.width,
      `field-panel checkbox width must be >=24px to meet WCAG 2.2 SC 2.5.8 (got ${rect.width}px)`
    ).toBeGreaterThanOrEqual(24);
    expect(
      rect.height,
      `field-panel checkbox height must be >=24px (got ${rect.height}px)`
    ).toBeGreaterThanOrEqual(24);
  });

  for (const label of ["mobile", "zoomedDesktop"]) {
    test(`table row checkbox provides 44x44 effective hit area at ${label}`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[label]);
      await seedBulkInventory(page);
      await gotoApp(page);
      await openBulkEditModal(page);

      const sel =
        '#bulkEditModal .bulk-edit-table tbody tr[data-serial="1"] input[type="checkbox"]';
      const hit = await getEffectiveHitArea(page, sel);
      expect(hit, "row checkbox host must exist").not.toBeNull();
      expect(
        hit.effectiveWidth,
        `row checkbox effective hit area width must be >=44px at ${label} (got ${hit.effectiveWidth}px; input=${hit.inputWidth}, host=${hit.hostWidth})`
      ).toBeGreaterThanOrEqual(44);
      expect(
        hit.effectiveHeight,
        `row checkbox effective hit area height must be >=44px at ${label} (got ${hit.effectiveHeight}px; input=${hit.inputHeight}, host=${hit.hostHeight})`
      ).toBeGreaterThanOrEqual(44);
    });

    test(`field-panel checkbox provides 44x44 effective hit area at ${label}`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[label]);
      await seedBulkInventory(page);
      await gotoApp(page);
      await openBulkEditModal(page);

      const sel = "#bulkEditModal #bulkField_qty";
      const hit = await getEffectiveHitArea(page, sel);
      expect(hit, "field-panel checkbox host must exist").not.toBeNull();
      expect(
        hit.effectiveWidth,
        `field-panel checkbox effective hit area width must be >=44px at ${label} (got ${hit.effectiveWidth}px)`
      ).toBeGreaterThanOrEqual(44);
      expect(
        hit.effectiveHeight,
        `field-panel checkbox effective hit area height must be >=44px at ${label} (got ${hit.effectiveHeight}px)`
      ).toBeGreaterThanOrEqual(44);
    });
  }
});

test.describe("STRK-91 B.1 — no overlap at narrow viewports (AC-3, AC-6)", () => {
  for (const label of ["mobile", "zoomedDesktop"]) {
    test(`toolbar, panel, table, and footer do not overlap at ${label}`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[label]);
      await seedBulkInventory(page);
      await gotoApp(page);
      await openBulkEditModal(page);

      const panel = await getRect(page, "#bulkEditModal #bulkEditFieldPanel");
      const toolbar = await getRect(page, "#bulkEditModal #bulkEditToolbar");
      const tableWrap = await getRect(page, "#bulkEditModal #bulkEditTableWrap");
      const footer = await getRect(page, "#bulkEditModal #bulkEditFooter");

      expect(panel, "field panel must exist").not.toBeNull();
      expect(toolbar, "toolbar must exist").not.toBeNull();
      expect(tableWrap, "table wrap must exist").not.toBeNull();
      expect(footer, "footer must exist").not.toBeNull();

      // Footer must NOT overlap the table or toolbar (the existing 375/640
      // regression: footer floats over Select All / table edge).
      expect(
        rectsOverlap(footer, toolbar),
        `footer (y=${footer.y}..${footer.bottom}) must not overlap toolbar (y=${toolbar.y}..${toolbar.bottom}) at ${label}`
      ).toBe(false);
      expect(
        rectsOverlap(footer, tableWrap),
        `footer (y=${footer.y}..${footer.bottom}) must not overlap table wrap (y=${tableWrap.y}..${tableWrap.bottom}) at ${label}`
      ).toBe(false);
      expect(rectsOverlap(footer, panel), `footer must not overlap field panel at ${label}`).toBe(
        false
      );

      // Panel and toolbar/table must stack cleanly at <=768px (panel above).
      expect(
        rectsOverlap(panel, toolbar),
        `field panel must not overlap toolbar at ${label} (stacked layout expected)`
      ).toBe(false);
      expect(
        rectsOverlap(panel, tableWrap),
        `field panel must not overlap table wrap at ${label}`
      ).toBe(false);

      // Footer must remain inside the viewport (a common breakage at 375px is
      // the footer pushed off the bottom because the modal content overflows).
      expect(
        footer.bottom,
        `footer bottom (${footer.bottom}) must be within viewport height (${VIEWPORTS[label].height}) at ${label}`
      ).toBeLessThanOrEqual(VIEWPORTS[label].height + 1);

      // Toolbar Select All / action buttons must not be covered by the footer.
      const selectAll = await getRect(
        page,
        '#bulkEditModal #bulkEditToolbar button:has-text("Select All")'
      );
      if (selectAll) {
        expect(
          rectsOverlap(footer, selectAll),
          `footer must not overlap Select All button at ${label}`
        ).toBe(false);
      }
    });
  }
});

// Re-export helpers for potential reuse by sibling specs in Cohort B.
// (Playwright test files can `import` from each other — keeping the surface
// here avoids a separate helpers/ module just for STRK-91.)
export {
  VIEWPORTS,
  makeBulkItem,
  REPRESENTATIVE_INVENTORY,
  seedBulkInventory,
  gotoApp,
  dismissWhatsNew,
  openBulkEditModal,
  selectAllBulkRows,
  getBulkHeaderCells,
  getBulkBodyRowCells,
};

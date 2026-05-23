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

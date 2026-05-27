import { test, expect } from "../../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../../helpers/seed.js";

/**
 * STRK-71 — inline chip: attachment settings
 *
 * TDD Phase: GREEN — all ACs implemented and passing.
 */

// seed-inventory.js has no attachment-bearing or disposed rows
const ATTACH_ITEM = {
  metal: "Silver",
  composition: "Silver",
  name: "STRK71-Attach-Test-Item",
  qty: 1,
  type: "Coin",
  weight: 1,
  price: 30.0,
  marketValue: 0,
  date: "2025-01-01",
  year: "2025",
  grade: "MS-70",
  gradingAuthority: "PCGS",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 0,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "298883",
  serial: 101,
  attachments: [{ attachmentUuid: "att-a1", fileName: "receipt.pdf" }],
};

// Disposed item WITH attachment — verifies attach chip in the disposed row section.
const DISPOSED_ATTACH_ITEM = {
  metal: "Silver",
  composition: "Silver",
  name: "STRK71-Disposed-Test-Item",
  qty: 1,
  type: "Coin",
  weight: 1,
  price: 30.0,
  marketValue: 0,
  date: "2025-01-02",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 0,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "",
  serial: 102,
  attachments: [{ attachmentUuid: "att-a2", fileName: "invoice.pdf" }],
  disposition: { type: "sold", realizedGainLoss: 5 },
};

// Index 0 = ATTACH_ITEM, index 1 = DISPOSED_ATTACH_ITEM

async function injectCustomInventory(page) {
  await injectSeedInventory(page);
  await page.addInitScript(
    (items) => {
      localStorage.setItem("metalInventory", JSON.stringify(items));
      localStorage.setItem("inventorySerial", JSON.stringify(102));
      localStorage.setItem("cardViewStyle", "D");
    },
    [ATTACH_ITEM, DISPOSED_ATTACH_ITEM]
  );
}

async function openInlineChipSettings(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("site"));
  const modal = page.locator("#settingsModal");
  await expect(modal).toBeVisible();
  await expect(page.locator("#settingsPanel_site")).toBeVisible();
  await expect(page.locator("#inlineChipConfigContainer")).toBeVisible();
}

async function closeSettings(page) {
  await page.locator("#settingsCloseBtn").click();
  await expect(page.locator("#settingsModal")).not.toBeVisible();
}

test.describe("STRK-71 — inline chip: attachment settings", () => {
  test.beforeEach(async ({ page }) => {
    await injectCustomInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.renderTable === "function");
  });

  // AC-1 — hides .attach-count-chip from a row that HAS attachment data after toggling off
  test("AC-1 — toggling Attachments off in settings hides .attach-count-chip", async ({ page }) => {
    // Chip is visible before toggle (hardcoded path renders it regardless of settings today)
    const attachChip = page.locator('[data-idx="0"] .attach-count-chip');
    await expect(attachChip).toBeVisible();

    await openInlineChipSettings(page);

    const attachToggle = page
      .locator('#inlineChipConfigContainer tr[data-section-id="attachment"]')
      .locator(".inline-chip-toggle");
    await expect(attachToggle).toBeVisible();
    await expect(attachToggle).toBeChecked();
    await attachToggle.click();
    await expect(attachToggle).not.toBeChecked();

    await closeSettings(page);

    // After toggle off, chip must not be visible
    await expect(attachChip).not.toBeVisible();
  });

  // AC-2 — re-toggling Attachments on restores .attach-count-chip
  test("AC-2 — re-toggling Attachments on restores .attach-count-chip", async ({ page }) => {
    // Disable attachment chip programmatically
    await page.evaluate(() => {
      const config = window
        .getInlineChipConfig()
        .map((c) => (c.id === "attachment" ? { ...c, enabled: false } : c));
      window.saveInlineChipConfig(config);
      window.renderTable();
    });

    const attachChip = page.locator('[data-idx="0"] .attach-count-chip');
    await expect(attachChip).not.toBeVisible();

    await openInlineChipSettings(page);

    const attachToggle = page
      .locator('#inlineChipConfigContainer tr[data-section-id="attachment"]')
      .locator(".inline-chip-toggle");
    await expect(attachToggle).not.toBeChecked();
    await attachToggle.click();
    await expect(attachToggle).toBeChecked();

    await closeSettings(page);

    await expect(attachChip).toBeVisible();
  });

  // AC-3 — all chips disabled: non-disposed attachment row has no .attach-count-chip
  // Uses [data-idx="0"] (ATTACH_ITEM — always visible, never filtered) to avoid the
  // fragile disposed-filter-reinitialization race that invalidates the disposed row.
  test("AC-3 — all chips disabled: .attach-count-chip absent from name cell", async ({ page }) => {
    // Disable ALL inline chips (pre-implementation: 9 entries, no attachment) then re-render
    await page.evaluate(() => {
      const config = window.getInlineChipConfig().map((c) => ({ ...c, enabled: false }));
      window.saveInlineChipConfig(config);
      window.renderTable();
    });

    const attachRow = page.locator('[data-idx="0"]');
    await expect(attachRow).toBeVisible();
    // Pre-implementation: attachChip is hardcoded OUTSIDE chipMap — disabling all 9 chips
    // does NOT remove it → toHaveCount(0) FAILs (count is 1).
    // Post-implementation: attachment is in chipMap and disabled → count is 0 → PASSes.
    await expect(attachRow.locator(".attach-count-chip")).toHaveCount(0);
  });

  // AC-4 — moving Attachments to position 1 renders .attach-count-chip leftmost in Name cell
  test("AC-4 — Attachments at position 1 renders .attach-count-chip before .grade-tag", async ({
    page,
  }) => {
    await openInlineChipSettings(page);

    const getAttachIdx = () =>
      page.evaluate(() => {
        const rows = Array.from(
          document.querySelectorAll("#inlineChipConfigContainer tr[data-section-id]")
        );
        return rows.findIndex((r) => r.dataset.sectionId === "attachment");
      });

    let idx = await getAttachIdx();
    // Row must exist; this assertion fails before implementation (no attachment row)
    expect(idx).toBeGreaterThanOrEqual(0);

    while (idx > 0) {
      const prevIdx = idx;
      await page
        .locator('#inlineChipConfigContainer tr[data-section-id="attachment"]')
        .locator(".inline-chip-move")
        .first()
        .click();
      await expect.poll(() => getAttachIdx(), { timeout: 2000 }).toBeLessThan(prevIdx);
      idx = await getAttachIdx();
    }

    await closeSettings(page);

    // .attach-count-chip must precede .grade-tag in document order within the Name cell
    const nameCellContent = page.locator('[data-idx="0"] .name-cell-content');
    const attachBeforeGrade = await nameCellContent.evaluate((el) => {
      const attach = el.querySelector(".attach-count-chip");
      const grade = el.querySelector(".grade-tag");
      if (!attach || !grade) return false;
      return !!(attach.compareDocumentPosition(grade) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(attachBeforeGrade).toBe(true);
  });

  // AC-5 — chip visibility and order persist after page.reload()
  test("AC-5 — chip settings persist across page reload", async ({ page }) => {
    await openInlineChipSettings(page);

    // Move Attachments up one position
    const attachRowPos = async () =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll("#inlineChipConfigContainer tr[data-section-id]")
        ).findIndex((r) => r.dataset.sectionId === "attachment")
      );
    const posBefore = await attachRowPos();
    await page
      .locator('#inlineChipConfigContainer tr[data-section-id="attachment"]')
      .locator(".inline-chip-move")
      .first()
      .click();
    await expect.poll(() => attachRowPos(), { timeout: 2000 }).toBeLessThan(posBefore);

    // Toggle off
    const attachToggle = page
      .locator('#inlineChipConfigContainer tr[data-section-id="attachment"]')
      .locator(".inline-chip-toggle");
    if (await attachToggle.isChecked()) {
      await attachToggle.click();
    }

    await closeSettings(page);
    await page.reload();
    await page.waitForFunction(() => typeof window.renderTable === "function");

    // After reload the toggle must still be off
    await openInlineChipSettings(page);
    const toggleAfter = page
      .locator('#inlineChipConfigContainer tr[data-section-id="attachment"]')
      .locator(".inline-chip-toggle");
    await expect(toggleAfter).not.toBeChecked();
  });

  // AC-6a — fresh install (no inlineChipConfig): default chip order in Name cell is
  //          grade-tag → numista-tag → year-tag → attach-count-chip
  test("AC-6a — fresh install: default Name cell chip order is grade, numista, year, attachment", async ({
    page,
  }) => {
    // Pre-implementation: attachment is NOT in INLINE_CHIP_DEFAULTS, so
    // getInlineChipConfig() returns only 9 entries and this assertion FAILs.
    // Post-implementation: 10-entry defaults include attachment → assertion PASSes.
    const config = await page.evaluate(() => window.getInlineChipConfig());
    const attachEntry = config.find((c) => c.id === "attachment");
    expect(attachEntry).toBeDefined();

    // Chip order check: grade-tag → numista-tag → year-tag → attach-count-chip
    const nameCellContent = page.locator('[data-idx="0"] .name-cell-content');
    const CLASSES = ["grade-tag", "numista-tag", "year-tag", "attach-count-chip"];

    const chipOrder = await nameCellContent.evaluate((el, classes) => {
      const chips = Array.from(el.querySelectorAll(classes.map((c) => "." + c).join(", ")));
      return chips.map((c) => classes.find((cls) => c.classList.contains(cls)));
    }, CLASSES);

    expect(chipOrder).toEqual(["grade-tag", "numista-tag", "year-tag", "attach-count-chip"]);
  });

  // AC-6b — upgrade path: pre-seed 9-entry config (no attachment), reload, merge appends
  //          attachment at end, chip renders rightmost
  test("AC-6b — upgrade from 9-entry config: attachment appended rightmost after merge", async ({
    page,
  }) => {
    const nineEntryConfig = [
      { id: "grade", label: "Grade", enabled: true },
      { id: "numista", label: "Numista (N#)", enabled: true },
      { id: "pcgs", label: "PCGS #", enabled: false },
      { id: "year", label: "Year", enabled: true },
      { id: "serial", label: "Serial #", enabled: false },
      { id: "storage", label: "Storage Location", enabled: false },
      { id: "notes", label: "Notes Indicator", enabled: false },
      { id: "purity", label: "Purity", enabled: false },
      { id: "tags", label: "Tags", enabled: false },
    ];
    await page.evaluate((cfg) => {
      localStorage.setItem("inlineChipConfig", JSON.stringify(cfg));
    }, nineEntryConfig);

    await page.reload();
    await page.waitForFunction(() => typeof window.renderTable === "function");

    // Merge logic at js/constants.js:1123-1127 must append attachment
    const mergedConfig = await page.evaluate(() => window.getInlineChipConfig());
    const attachEntry = mergedConfig.find((c) => c.id === "attachment");
    expect(attachEntry).toBeDefined();
    expect(attachEntry.enabled).toBe(true);
    expect(mergedConfig.at(-1).id).toBe("attachment");

    // Chip renders rightmost
    const nameCellContent = page.locator('[data-idx="0"] .name-cell-content');
    const CLASSES = ["grade-tag", "numista-tag", "year-tag", "attach-count-chip"];
    const chipOrder = await nameCellContent.evaluate((el, classes) => {
      const chips = Array.from(el.querySelectorAll(classes.map((c) => "." + c).join(", ")));
      return chips.map((c) => classes.find((cls) => c.classList.contains(cls)));
    }, CLASSES);
    expect(chipOrder).toEqual(["grade-tag", "numista-tag", "year-tag", "attach-count-chip"]);
  });

  // AC-7 — disabling table Attachments does NOT suppress .cv-chip-attach in card view
  test("AC-7 — table Attachments toggle does not suppress card-view .cv-chip-attach", async ({
    page,
  }) => {
    // Disable attachment chip for table view (no-op pre-implementation; correct post-impl)
    await page.evaluate(() => {
      const config = window
        .getInlineChipConfig()
        .map((c) => (c.id === "attachment" ? { ...c, enabled: false } : c));
      window.saveInlineChipConfig(config);
    });

    // Switch to card view A via the sort bar
    await page.locator('#cardStyleToggle .chip-sort-btn[data-style="A"]').click();
    // Wait for card view to render
    await page.waitForSelector(".cv-chip-attach", { timeout: 5000 });

    // Card view chip is independent of inlineChipConfig — must remain visible
    await expect(page.locator(".cv-chip-attach").first()).toBeVisible();
  });

  // AC-8 — Settings panel has exactly 10 rows, one labeled "Attachments"
  test("AC-8 — inline chip settings panel has exactly 10 rows including Attachments", async ({
    page,
  }) => {
    await openInlineChipSettings(page);

    const rows = page.locator("#inlineChipConfigContainer tr[data-section-id]");
    await expect(rows).toHaveCount(10);

    const attachRow = page.locator('#inlineChipConfigContainer tr[data-section-id="attachment"]');
    await expect(attachRow).toBeVisible();
    await expect(attachRow.locator("td").nth(1)).toHaveText("Attachments");
  });
});

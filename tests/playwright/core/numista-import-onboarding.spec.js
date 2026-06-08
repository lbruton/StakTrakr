import { test, expect } from "../helpers/mocks/extended-test.js";

// STRK-167 — Numista import: instance-aware de-duplication + restored safe merge.
//
// Supersedes the STRK-165 interim onboarding/replace gate (shipped v3.35.11). The
// importer now routes a non-empty inventory through the SAME diff-review merge
// path as importCsv (#diffReviewModal), with an instance-aware identity key
// (numistaId|year|grade|certNumber) so:
//   - identical ungraded rows collapse with summed qty,
//   - distinct graded instances stay separate,
//   - re-importing the same CSV produces no duplicates,
//   - an ungraded row that shares numistaId+year with a graded existing item
//     gets an advisory badge (never an auto-merge, never a persisted flag).
//
// These are RED until Cohort C lands (merge route + key + qty control + badge).

const mk = (over) => ({
  uuid: over.uuid,
  metal: "Silver",
  composition: "Silver",
  name: over.name,
  qty: over.qty != null ? over.qty : 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 0,
  date: "2026-06-06",
  purchaseLocation: "StakTrakr",
  storageLocation: "",
  notes: "",
  year: over.year,
  grade: over.grade || "",
  gradingAuthority: over.grade ? "PCGS" : "",
  certNumber: over.certNumber || "",
  pcgsNumber: "",
  pcgsVerified: false,
  purity: 0.999,
  spotPriceAtPurchase: 30,
  premiumPerOz: 0,
  totalPremium: 0,
  numistaId: over.numistaId,
  serial: over.serial,
});

// Numista CSV header observed in the real export.
const CSV_HEADER = "Title,Composition,Quantity,N# number,Year";
const csv = (...rows) => [CSV_HEADER, ...rows].join("\n");

async function seed(page, inv) {
  await page.addInitScript((data) => {
    localStorage.setItem("metalInventory", JSON.stringify(data));
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  }, inv);
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => typeof window.importNumistaCsv === "function" && Array.isArray(window.inventory)
  );
}

// Trigger a (non-override) Numista import. Not awaited internally — the modal
// appears after the async file read.
async function triggerImport(page, csvText) {
  await page.evaluate((text) => {
    const file = new File([text], "numista.csv", { type: "text/csv" });
    window.importNumistaCsv(file, false);
  }, csvText);
}

// Capture the DiffModal.show options for a single import without rendering DOM.
// Returns { shown, added, modified, deleted, possibleDuplicateKeys, replaceDialog }.
async function captureDiff(page, csvText) {
  return page.evaluate(async (text) => {
    const origShow = window.DiffModal.show;
    const origToast = window.showToast;
    let captured = null;
    let replaceDialog = false;
    const origActionDialog = window.showAppActionDialog;
    if (typeof origActionDialog === "function") {
      window.showAppActionDialog = (...args) => {
        replaceDialog = true;
        return origActionDialog.apply(window, args);
      };
    }
    window.DiffModal.show = (opts) => {
      captured = opts;
    };
    window.showToast = () => {};
    const file = new File([text], "numista.csv", { type: "text/csv" });
    await window.importNumistaCsv(file, false);
    // allow the async parse/route microtasks to settle
    await new Promise((r) => setTimeout(r, 50));
    window.DiffModal.show = origShow;
    window.showToast = origToast;
    if (origActionDialog) window.showAppActionDialog = origActionDialog;
    const dups = captured && captured.possibleDuplicates;
    return {
      shown: !!captured,
      added: captured ? captured.diff.added.length : 0,
      modified: captured ? captured.diff.modified.length : 0,
      deleted: captured ? captured.diff.deleted.length : 0,
      addedQtys: captured ? captured.diff.added.map((a) => (a.remote || a).qty) : [],
      possibleDuplicateCount: dups ? (dups.size != null ? dups.size : dups.length || 0) : 0,
      replaceDialog,
    };
  }, csvText);
}

test.describe("STRK-167 Numista instance-aware merge", () => {
  test("AC-7/AC-12 — non-empty import opens the diff-review modal, not a replace dialog", async ({
    page,
  }) => {
    await seed(page, [
      mk({ uuid: "ex-1", name: "Existing One", year: "2020", numistaId: "111", serial: 1 }),
    ]);
    await gotoApp(page);
    await page.waitForFunction(() => window.inventory.length === 1);

    await triggerImport(page, csv("Test Eagle,Silver,1,99999,2024"));
    await expect(page.locator("#diffReviewModal")).toBeVisible();
    // STRK-165 interim replace dialog must NOT appear.
    await expect(page.locator("#appDialogModal")).toBeHidden();
  });

  test("AC-9 — empty inventory presents every row as an add through the merge path", async ({
    page,
  }) => {
    await seed(page, []);
    await gotoApp(page);
    await page.evaluate(() => {
      window.inventory = [];
    });

    const res = await captureDiff(
      page,
      csv("Eagle A,Silver,1,111,2024", "Eagle B,Silver,1,222,2024")
    );
    expect(res.shown).toBe(true);
    expect(res.replaceDialog).toBe(false);
    expect(res.added).toBe(2);
    expect(res.modified).toBe(0);
  });

  test("AC-6 — repeated N# (same year, ungraded) collapses to one row with summed qty", async ({
    page,
  }) => {
    await seed(page, []);
    await gotoApp(page);
    await page.evaluate(() => {
      window.inventory = [];
    });

    // Three CSV rows, same N# + year, ungraded → one collapsed add of qty 6.
    const res = await captureDiff(
      page,
      csv("Eagle,Silver,1,555,2024", "Eagle,Silver,2,555,2024", "Eagle,Silver,3,555,2024")
    );
    expect(res.added).toBe(1);
    expect(res.addedQtys).toEqual([6]);
  });

  test("AC-8 — importing the same CSV twice yields zero duplicate instances", async ({ page }) => {
    await seed(page, [
      mk({ uuid: "ex-1", name: "Eagle", year: "2024", numistaId: "777", serial: 1 }),
    ]);
    await gotoApp(page);
    await page.waitForFunction(() => window.inventory.length === 1);

    const sameCsv = csv("Eagle,Silver,1,777,2024");

    // First import: same instance already present → no add (unchanged or modified only).
    const first = await captureDiff(page, sameCsv);
    expect(first.added).toBe(0);

    // Apply the real modal once, then re-import: still zero duplicates.
    await triggerImport(page, sameCsv);
    // If a diff modal is shown, apply it; default qty selection is Replace (idempotent).
    if (
      await page
        .locator("#diffReviewModal")
        .isVisible()
        .catch(() => false)
    ) {
      await page.click("#diffReviewApplyBtn");
      await expect(page.locator("#diffReviewModal")).toBeHidden();
    }
    const dupCount = await page.evaluate(() => {
      const key = (i) =>
        `${i.numistaId}|${i.year}|${(i.grade || "").trim().toLowerCase()}|${(i.certNumber || "").trim().toLowerCase()}`;
      const seen = {};
      let dups = 0;
      for (const i of window.inventory) {
        if (!i.numistaId) continue;
        const k = key(i);
        if (seen[k]) dups++;
        seen[k] = true;
      }
      return dups;
    });
    expect(dupCount).toBe(0);
  });

  test("AC-13 — override import replaces directly with no diff modal", async ({ page }) => {
    await seed(page, [
      mk({ uuid: "ex-1", name: "Existing One", year: "2020", numistaId: "111", serial: 1 }),
      mk({ uuid: "ex-2", name: "Existing Two", year: "2021", numistaId: "222", serial: 2 }),
    ]);
    await gotoApp(page);
    await page.waitForFunction(() => window.inventory.length === 2);

    await page.evaluate((text) => {
      const file = new File([text], "numista.csv", { type: "text/csv" });
      window.importNumistaCsv(file, true); // override → direct replace, no modal
    }, csv("Test Eagle,Silver,1,99999,2024"));

    await page.waitForFunction(() => window.inventory.length === 1);
    await expect(page.locator("#diffReviewModal")).toBeHidden();
    await expect(page.locator("#appDialogModal")).toBeHidden();
    expect(await page.evaluate(() => window.inventory[0].numistaId)).toBe("99999");
  });

  test("AC-10 — qty 3-way control: Keep/Replace(default)/Add, sum on apply, keyboard activation", async ({
    page,
  }) => {
    // Existing ungraded instance qty 1; import same instance qty 5 → modified qty row.
    await seed(page, [
      mk({ uuid: "ex-1", name: "Eagle", year: "2024", numistaId: "444", serial: 1, qty: 1 }),
    ]);
    await gotoApp(page);
    await page.waitForFunction(() => window.inventory.length === 1);

    await triggerImport(page, csv("Eagle,Silver,5,444,2024"));
    await expect(page.locator("#diffReviewModal")).toBeVisible();

    const group = page.locator("#diffReviewModal .dm-qty-options[role='radiogroup']").first();
    await expect(group).toBeVisible();
    const opts = group.locator("[role='radio']");
    await expect(opts).toHaveCount(3);
    // Replace is the default selection.
    await expect(group.locator(".dm-qty-opt.remote")).toHaveAttribute("aria-checked", "true");

    // Keyboard: focus the "Add to existing" radio and activate with Space.
    const sum = group.locator(".dm-qty-opt.sum");
    await sum.focus();
    await page.keyboard.press(" ");
    await expect(sum).toHaveAttribute("aria-checked", "true");
    await expect(group.locator(".dm-qty-opt.remote")).toHaveAttribute("aria-checked", "false");

    // Apply → qty becomes local + remote = 1 + 5 = 6.
    await page.click("#diffReviewApplyBtn");
    await expect(page.locator("#diffReviewModal")).toBeHidden();
    expect(await page.evaluate(() => window.inventory.find((i) => i.numistaId === "444").qty)).toBe(
      6
    );
  });

  test("AC-11 — ungraded import of a graded existing N#+year: advisory badge, skippable, no persisted flag", async ({
    page,
  }) => {
    // Existing GRADED instance; import an UNGRADED row with the same numistaId+year.
    await seed(page, [
      mk({
        uuid: "ex-1",
        name: "Eagle",
        year: "2024",
        numistaId: "333",
        serial: 1,
        grade: "MS70",
        certNumber: "C1",
      }),
    ]);
    await gotoApp(page);
    await page.waitForFunction(() => window.inventory.length === 1);

    // Sidecar: the importer flags the ungraded add as a possible duplicate.
    const res = await captureDiff(page, csv("Eagle,Silver,1,333,2024"));
    expect(res.added).toBe(1); // a genuine add, not a destructive modify of the graded item
    expect(res.modified).toBe(0);
    expect(res.possibleDuplicateCount).toBe(1);

    // The advisory badge renders on the added card.
    await triggerImport(page, csv("Eagle,Silver,1,333,2024"));
    await expect(page.locator("#diffReviewModal")).toBeVisible();
    await expect(
      page.locator("#diffReviewModal .dm-orphan-card .dm-dup-flag").first()
    ).toBeVisible();

    // Apply (importing the add) — the graded item is preserved and NO _possibleDuplicate persists.
    await page.click("#diffReviewApplyBtn");
    await expect(page.locator("#diffReviewModal")).toBeHidden();
    const audit = await page.evaluate(() => {
      const graded = window.inventory.find((i) => i.certNumber === "C1");
      return {
        gradedPreserved: !!graded && graded.grade === "MS70",
        anyFlag: window.inventory.some((i) =>
          Object.prototype.hasOwnProperty.call(i, "_possibleDuplicate")
        ),
        count: window.inventory.filter((i) => i.numistaId === "333").length,
      };
    });
    expect(audit.gradedPreserved).toBe(true);
    expect(audit.anyFlag).toBe(false);
    expect(audit.count).toBe(2); // graded + ungraded, kept separate
  });
});

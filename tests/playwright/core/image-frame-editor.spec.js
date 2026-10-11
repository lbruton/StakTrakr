// STRK-427 (tasks B.4, B.5) — the shared image-frame editor in the Add/Edit Item modal.
//
// Written BEFORE the implementation (TDD red phase). It pins the approved A.1 mockup
// (playground/STRK-427-image-frame-editor.html) as an interaction contract, not just storage:
//
//   .ife                       the editor root, inside #imageUploadGroup
//   .ife-frame                 one preview frame per side (obverse first), carrying
//                              data-shape and, for Bar and Note only, data-orientation
//   radiogroup "Image shape"   Round | Bar | Note | Slab
//   radiogroup "Obverse orientation" / "Reverse orientation"   Portrait | Landscape (Bar, Note only)
//   #swapImagesBtn             the existing guarded swap button (ids and guards unchanged)
//
// Frame ratios are the shared tokens: Round 1, Slab 0.68, Bar 0.6 portrait / 1.6 landscape,
// Note 0.4878 portrait / 2.05 landscape. Frames sit in a square bounding box, so a frame's
// rendered width/height is its ratio.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { suppressWhatsNewPopup } from "../helpers/seed.js";
import { collectionItem, seedCollectionsPage } from "../helpers/collections-fixtures.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgQAAAABJRU5ErkJggg==",
  "base64"
);

const SEED_ITEM = {
  uuid: "strk-427-item",
  metal: "Silver",
  composition: "Silver",
  name: "STRK-427 Frame Fixture",
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 0,
  date: "2026-05-10",
  purchaseLocation: "StakTrakr",
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
  serial: 1,
  obverseImageUrl: "https://images.example/obv.png",
  reverseImageUrl: "https://images.example/rev.png",
};

const FRAME_KEYS = [
  "imageShape",
  "obverseImageOrientation",
  "reverseImageOrientation",
  "obverseImageFrame",
  "reverseImageFrame",
];

/** Rendered width / height of each shape and orientation (the shared ratio tokens). */
const RATIO = {
  round: 1,
  slab: 0.68,
  "bar-portrait": 0.6,
  "bar-landscape": 1.6,
  "note-portrait": 0.4878,
  "note-landscape": 2.05,
};

/**
 * Seeds inventory and boots the Inventory tab to a settled app.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {{items?: object[], flags?: object}} [options] - Seed items and feature-flag overrides
 * @returns {Promise<void>}
 */
async function seedAndGoto(page, { items = [SEED_ITEM], flags = null } = {}) {
  await page.addInitScript(
    ({ seedItems, seedFlags }) => {
      localStorage.setItem("metalInventory", JSON.stringify(seedItems));
      localStorage.setItem("itemTags", JSON.stringify({}));
      if (seedFlags) localStorage.setItem("featureFlags", JSON.stringify(seedFlags));
    },
    { seedItems: items, seedFlags: flags }
  );
  await suppressWhatsNewPopup(page);
  await page.route("https://images.example/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG })
  );
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      window.appListenersReady === true &&
      typeof window.editItem === "function" &&
      Array.isArray(window.inventory)
  );
}

/**
 * Opens the add-item modal through the production button path.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
async function openAddModal(page) {
  await page.evaluate(() => document.getElementById("newItemBtn").click());
  await expect(page.locator("#itemModal")).toBeVisible({ timeout: 10000 });
  await settleModal(page);
}

/**
 * Waits for the modal entrance animation. `.modal-content` runs `modalSlideIn`, a
 * `scale(0.95)` transform, so a bounding rect read mid-animation is 5% too small.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
async function settleModal(page) {
  await page
    .locator("#itemModal .modal-content")
    .evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
}

/**
 * Opens the edit modal for the seeded item and waits for its previews.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} [uuid] - Item uuid
 * @returns {Promise<void>}
 */
async function openEditModal(page, uuid = SEED_ITEM.uuid) {
  await page.evaluate(
    (id) => window.editItem(window.inventory.findIndex((item) => item.uuid === id)),
    uuid
  );
  await expect(page.locator("#itemModal")).toBeVisible();
  await settleModal(page);
  await expect(page.locator("#itemImagePreviewImgObv")).toBeVisible();
}

/**
 * Opens the Duplicate modal for a seeded item through the production entry point.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} [uuid] - Source item uuid
 * @returns {Promise<void>}
 */
async function openDuplicateModal(page, uuid = SEED_ITEM.uuid) {
  await page.evaluate(
    (id) => window.duplicateItem(window.inventory.findIndex((item) => item.uuid === id)),
    uuid
  );
  await expect(page.locator("#itemModal")).toBeVisible();
  await settleModal(page);
}

/**
 * Reads the record a save created next to the seeded source item.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} [sourceUuid] - Source item uuid
 * @returns {Promise<object>} The newly created copy
 */
const copyOf = (page, sourceUuid = SEED_ITEM.uuid) =>
  page.evaluate(
    (id) => JSON.parse(JSON.stringify(window.inventory.find((item) => item.uuid !== id))),
    sourceUuid
  );

/**
 * Locators for the editor inside the item modal.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {{root: import('@playwright/test').Locator, frames: import('@playwright/test').Locator,
 *   shape: import('@playwright/test').Locator, orient: (side: string) => import('@playwright/test').Locator}}
 */
function editor(page) {
  const root = page.locator("#itemModal .ife");
  return {
    root,
    frames: root.locator(".ife-frame"),
    shape: root.getByRole("radiogroup", { name: "Image shape" }),
    orient: (side) => root.getByRole("radiogroup", { name: `${side} orientation` }),
  };
}

/**
 * Rendered width / height of a locator.
 * @param {import('@playwright/test').Locator} locator - Frame element
 * @returns {Promise<number>} Aspect ratio
 */
async function ratioOf(locator) {
  const box = await locator.boundingBox();
  return box.width / box.height;
}

/**
 * Asserts a frame has the given data attributes and renders that ratio.
 * @param {import('@playwright/test').Locator} frame - Frame element
 * @param {string} shape - Expected data-shape
 * @param {string|null} orientation - Expected data-orientation, or null for none
 * @returns {Promise<void>}
 */
async function expectFrame(frame, shape, orientation = null) {
  await expect(frame).toHaveAttribute("data-shape", shape);
  if (orientation) await expect(frame).toHaveAttribute("data-orientation", orientation);
  else await expect(frame).not.toHaveAttribute("data-orientation", /.+/);
  const key = orientation ? `${shape}-${orientation}` : shape;
  expect(await ratioOf(frame)).toBeCloseTo(RATIO[key], 1);
}

/**
 * Reads the stored record for the seeded item.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} [uuid] - Item uuid
 * @returns {Promise<object>} The stored item
 */
const storedItem = (page, uuid = SEED_ITEM.uuid) =>
  page.evaluate(
    (id) => JSON.parse(JSON.stringify(window.inventory.find((i) => i.uuid === id))),
    uuid
  );

/**
 * Submits the item modal and waits for it to close.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
async function submit(page) {
  await page.locator("#itemModalSubmit").click();
  await expect(page.locator("#itemModal")).toBeHidden();
}

/**
 * Opens the collapsed Grading section so its controls are reachable.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
async function openGrading(page) {
  const section = page.locator('details.form-section[data-section="grading"]');
  if (!(await section.evaluate((el) => el.open))) await section.locator("summary").click();
}

/**
 * From the open edit modal, enters clone mode, unchecks one clone control, and saves.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} controlSelector - The clone checkbox to uncheck
 * @param {{grading?: boolean}} [options] - Open the collapsed Grading section first
 * @returns {Promise<object>} The newly created clone record
 */
async function saveCloneWithout(page, controlSelector, { grading = false } = {}) {
  await page.locator("#cloneItemBtn").click();
  if (grading) await openGrading(page);
  await page.locator(controlSelector).uncheck();
  await submit(page);
  return page.evaluate(
    (id) => JSON.parse(JSON.stringify(window.inventory.find((item) => item.uuid !== id))),
    SEED_ITEM.uuid
  );
}

test.describe("core/image-frame-editor — item modal (STRK-427)", () => {
  test("E-empty: shape control and both empty frames show before any image exists, flag off hides the group", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const ife = editor(page);
    await expect(ife.shape).toBeVisible();
    await expect(ife.frames).toHaveCount(2);
    await expect(ife.frames.nth(0)).toBeVisible();
    await expect(ife.frames.nth(1)).toBeVisible();
    await expectFrame(ife.frames.nth(0), "round");
    // STRK-434: Swap is always rendered, held disabled until a side holds an image.
    await expect(page.locator("#swapImagesBtn")).toBeVisible();
    await expect(page.locator("#swapImagesBtn")).toBeDisabled();
  });

  test("the COIN_IMAGES flag still hides the whole image group, editor included (D-16)", async ({
    page,
  }) => {
    await seedAndGoto(page, { flags: { COIN_IMAGES: false } });
    await openAddModal(page);
    await expect(page.locator("#imageUploadGroup")).toBeHidden();
    await expect(editor(page).shape).toBeHidden();
  });

  test("choosing a shape reshapes both frames immediately, with no save", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const ife = editor(page);
    for (const [label, shape, orientation] of [
      ["Slab", "slab", null],
      ["Bar", "bar", "portrait"],
      ["Note", "note", "landscape"],
      ["Round", "round", null],
    ]) {
      await ife.shape.getByLabel(label).check();
      await expectFrame(ife.frames.nth(0), shape, orientation);
      await expectFrame(ife.frames.nth(1), shape, orientation);
    }
  });

  test("Round and Slab show no orientation controls; Bar and Note show one group per side at their default", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const ife = editor(page);
    for (const label of ["Round", "Slab"]) {
      await ife.shape.getByLabel(label).check();
      await expect(ife.orient("Obverse")).toHaveCount(0);
      await expect(ife.orient("Reverse")).toHaveCount(0);
    }
    await ife.shape.getByLabel("Bar").check();
    await expect(ife.orient("Obverse").getByLabel("Portrait")).toBeChecked();
    await expect(ife.orient("Reverse").getByLabel("Portrait")).toBeChecked();
    await ife.shape.getByLabel("Note").check();
    await expect(ife.orient("Obverse").getByLabel("Landscape")).toBeChecked();
    await expect(ife.orient("Reverse").getByLabel("Landscape")).toBeChecked();
    await ife.orient("Reverse").getByLabel("Portrait").check();
    await expectFrame(ife.frames.nth(1), "note", "portrait");
    await expectFrame(ife.frames.nth(0), "note", "landscape");
  });

  test("all four shapes are selectable for Coin, Bar and Goldback", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const ife = editor(page);
    for (const type of ["Coin", "Bar", "Goldback"]) {
      await page.locator("#itemType").selectOption(type);
      for (const label of ["Round", "Bar", "Note", "Slab"]) {
        await ife.shape.getByLabel(label).check();
        await expect(ife.shape.getByLabel(label)).toBeChecked();
        await expect(ife.frames.nth(0)).toHaveAttribute("data-shape", label.toLowerCase());
      }
    }
  });

  test("E-follow: an untouched shape follows Type, Coin to Goldback shows Note", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const ife = editor(page);
    await page.locator("#itemType").selectOption("Coin");
    await expectFrame(ife.frames.nth(0), "round");
    await page.locator("#itemType").selectOption("Goldback");
    await expectFrame(ife.frames.nth(0), "note", "landscape");
    await page.locator("#itemType").selectOption("Bar");
    await expectFrame(ife.frames.nth(0), "bar", "portrait");
    await page.locator("#itemType").selectOption("Coin");
    await expectFrame(ife.frames.nth(0), "round");
  });

  test("E-pinned: a chosen shape survives a Type change", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const ife = editor(page);
    await page.locator("#itemType").selectOption("Coin");
    await ife.shape.getByLabel("Slab").check();
    await page.locator("#itemType").selectOption("Goldback");
    await expectFrame(ife.frames.nth(0), "slab");
    await page.locator("#itemType").selectOption("Bar");
    await expectFrame(ife.frames.nth(0), "slab");
  });

  test("a grade re-derives an untouched shape and never moves a chosen one (AC-4.5)", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    await openGrading(page);
    const ife = editor(page);
    await page.locator("#itemType").selectOption("Coin");

    // Untouched: grading authority makes it Slab, clearing it returns to Round.
    await page.locator("#itemGradingAuthority").selectOption("PCGS");
    await expectFrame(ife.frames.nth(0), "slab");
    await page.locator("#itemGradingAuthority").selectOption("");
    await expectFrame(ife.frames.nth(0), "round");

    // Chosen Round: a grade must not move it, even though Round equals the derived default.
    // Round is already the selected radio, so the user's choice is a click, not a change.
    await ife.shape.getByLabel("Round").click();
    await page.locator("#itemGradingAuthority").selectOption("NGC");
    await expectFrame(ife.frames.nth(0), "round");
  });

  test("a programmatic grading or Numista-shape set followed by the notify call re-derives an untouched shape", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const ife = editor(page);
    await page.locator("#itemType").selectOption("Coin");
    // The PCGS lookup and the Numista picker set `.value` directly, which fires no event;
    // they tell the editor through window.notifyImageFrameSignals(kind) (D-6).
    await page.evaluate(() => {
      document.getElementById("itemGradingAuthority").value = "PCGS";
      window.notifyImageFrameSignals("grading");
    });
    await expectFrame(ife.frames.nth(0), "slab");
    await page.evaluate(() => {
      document.getElementById("itemGradingAuthority").value = "";
      window.notifyImageFrameSignals("grading");
    });
    await expectFrame(ife.frames.nth(0), "round");
    await page.evaluate(() => {
      document.getElementById("numistaShape").value = "Rectangular";
      window.notifyImageFrameSignals("numista");
    });
    await expectFrame(ife.frames.nth(0), "bar", "portrait");
  });

  test("clone: unchecking Grading Authority re-derives an untouched Slab to Round, stored sparse (Codex P2)", async ({
    page,
  }) => {
    await seedAndGoto(page, {
      items: [{ ...SEED_ITEM, grade: "MS 69", gradingAuthority: "PCGS" }],
    });
    await openEditModal(page);
    await expectFrame(editor(page).frames.nth(0), "slab");

    // clearUncheckedCloneFields() clears the select programmatically (no change event) just
    // before parseItemFormFields, so the editor must be told before the frame is collected.
    const clone = await saveCloneWithout(
      page,
      '.clone-field-cb[data-clone-field="gradingAuthority"]',
      { grading: true }
    );
    expect(clone.gradingAuthority || "").toBe("");
    for (const key of FRAME_KEYS) expect(clone[key], `${key} derives Round`).toBeUndefined();
  });

  test("clone: unchecking the Numista Data section re-derives an untouched Bar to Round, stored sparse (Codex P2)", async ({
    page,
  }) => {
    await seedAndGoto(page, {
      items: [{ ...SEED_ITEM, numistaData: { shape: "Rectangular" } }],
    });
    await openEditModal(page);
    await expectFrame(editor(page).frames.nth(0), "bar", "portrait");

    const clone = await saveCloneWithout(
      page,
      '.clone-section-cb[data-clone-section="numistaData"]'
    );
    for (const key of FRAME_KEYS) expect(clone[key], `${key} derives Round`).toBeUndefined();
  });

  test("duplicate: a Bar item opens with Bar selected and saves the copy sparse (Codex P2)", async ({
    page,
  }) => {
    await seedAndGoto(page, { items: [{ ...SEED_ITEM, type: "Bar" }] });
    await openDuplicateModal(page);
    const ife = editor(page);
    // duplicateItem stays in add mode and never opens through the edit seed, so the editor
    // must be seeded from the source record or it keeps the fresh-page Round.
    await expect(ife.shape.getByLabel("Bar")).toBeChecked();
    await expectFrame(ife.frames.nth(0), "bar", "portrait");

    await submit(page);
    const copy = await copyOf(page);
    expect(copy.name).toBe(SEED_ITEM.name);
    for (const key of FRAME_KEYS) expect(copy[key], `${key} derives Bar`).toBeUndefined();
  });

  test("duplicate: an explicitly framed item keeps its shape and orientation (Codex P2)", async ({
    page,
  }) => {
    await seedAndGoto(page, {
      items: [
        {
          ...SEED_ITEM,
          imageShape: "note",
          obverseImageOrientation: "portrait",
          obverseImageFrame: "rectangle",
          reverseImageFrame: "rectangle",
        },
      ],
    });
    await openDuplicateModal(page);
    const ife = editor(page);
    await expect(ife.shape.getByLabel("Note")).toBeChecked();
    await expect(ife.orient("Obverse").getByLabel("Portrait")).toBeChecked();
    await expect(ife.orient("Reverse").getByLabel("Landscape")).toBeChecked();
    await expectFrame(ife.frames.nth(0), "note", "portrait");
    await expectFrame(ife.frames.nth(1), "note", "landscape");

    await submit(page);
    const copy = await copyOf(page);
    expect(copy.imageShape).toBe("note");
    expect(copy.obverseImageOrientation).toBe("portrait");
    expect(copy.reverseImageOrientation).toBeUndefined();
    expect(copy.obverseImageFrame).toBe("rectangle");
    expect(copy.reverseImageFrame).toBe("rectangle");
  });

  test("E-mixed: Swap exchanges the images and their orientations and leaves the shape alone", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openEditModal(page);
    const ife = editor(page);
    await ife.shape.getByLabel("Bar").check();
    await ife.orient("Obverse").getByLabel("Portrait").check();
    await ife.orient("Reverse").getByLabel("Landscape").check();
    await expectFrame(ife.frames.nth(0), "bar", "portrait");
    await expectFrame(ife.frames.nth(1), "bar", "landscape");

    await page.locator("#swapImagesBtn").click();
    await expectFrame(ife.frames.nth(0), "bar", "landscape");
    await expectFrame(ife.frames.nth(1), "bar", "portrait");
    await expect(ife.shape.getByLabel("Bar")).toBeChecked();
  });

  test("the swap guards are unchanged: the group is busy and inert while a swap is pending", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openEditModal(page);
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      const gate = new Promise((resolve) => {
        window.__releaseSwap = resolve;
      });
      window.fetch = async (input, ...args) => {
        if (String(input).startsWith("blob:")) await gate;
        return originalFetch(input, ...args);
      };
    });
    // Blob previews come from an upload; URL images skip the blob read, so make both sides local.
    await page.setInputFiles("#itemImageFileObv", "tests/playwright/helpers/test-obverse.png");
    await page.setInputFiles("#itemImageFileRev", "tests/playwright/helpers/test-reverse.png");
    await page.locator("#swapImagesBtn").click();
    await expect(page.locator("#imageUploadGroup")).toHaveAttribute("aria-busy", "true");
    expect(await page.locator("#imageUploadGroup").evaluate((el) => el.inert)).toBe(true);
    await expect(page.locator("#swapImagesBtn")).toBeDisabled();
    await page.evaluate(() => window.__releaseSwap());
    await expect(page.locator("#imageUploadGroup")).not.toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#swapImagesBtn")).toBeEnabled();
  });

  test("Swap is enabled whenever a side holds an image and disabled with none, across seed, upload, Remove and swap", async ({
    page,
  }) => {
    await seedAndGoto(page, { items: [{ ...SEED_ITEM, reverseImageUrl: "" }] });
    await openEditModal(page);
    const ife = editor(page);
    const swap = page.locator("#swapImagesBtn");
    // STRK-434: Swap is always rendered. One filled side is enough (it moves the lone image
    // across), so it is enabled; both frames stay visible.
    await expect(ife.frames.nth(0)).toBeVisible();
    await expect(ife.frames.nth(1)).toBeVisible();
    await expect(swap).toBeVisible();
    await expect(swap).toBeEnabled();

    await page.setInputFiles("#itemImageFileRev", "tests/playwright/helpers/test-reverse.png");
    await expect(swap).toBeEnabled();

    // Removing the reverse leaves the obverse image, so Swap stays enabled.
    await page.locator("#itemImageRemoveBtnRev").click();
    await expect(swap).toBeEnabled();
    await expect(ife.frames.nth(1)).toBeVisible();

    // Removing the last image disables it, but it stays rendered.
    await page.locator("#itemImageRemoveBtnObv").click();
    await expect(swap).toBeVisible();
    await expect(swap).toBeDisabled();

    await page.setInputFiles("#itemImageFileRev", "tests/playwright/helpers/test-reverse.png");
    await expect(swap).toBeEnabled();
    await swap.click();
    await expect(swap).toBeEnabled();

    // A brand-new item with no images at all: both frames visible, Swap rendered but disabled.
    await submit(page);
    await openAddModal(page);
    await expect(editor(page).frames.nth(0)).toBeVisible();
    await expect(swap).toBeVisible();
    await expect(swap).toBeDisabled();
  });

  test("Remove resets that side's orientation to its default and keeps the shape (AC-3.3)", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openEditModal(page);
    const ife = editor(page);
    await ife.shape.getByLabel("Bar").check();
    await ife.orient("Reverse").getByLabel("Landscape").check();
    await page.locator("#itemImageRemoveBtnRev").click();
    await expect(ife.shape.getByLabel("Bar")).toBeChecked();
    await expect(ife.orient("Reverse").getByLabel("Portrait")).toBeChecked();
    await expectFrame(ife.frames.nth(1), "bar", "portrait");
  });

  for (const [label, shape, orientation] of [
    ["Round", "round", null],
    ["Bar", "bar", "landscape"],
    ["Note", "note", "portrait"],
    ["Slab", "slab", null],
  ]) {
    test(`save and reopen shows exactly the chosen ${label} (AC-7.2) and stores only deviations`, async ({
      page,
    }) => {
      await seedAndGoto(page);
      await openEditModal(page);
      let ife = editor(page);
      await ife.shape.getByLabel(label).check();
      if (orientation)
        await ife
          .orient("Obverse")
          .getByLabel(orientation === "landscape" ? "Landscape" : "Portrait")
          .check();
      await submit(page);

      const stored = await storedItem(page);
      if (shape === "round") {
        for (const key of FRAME_KEYS)
          expect(stored[key], `${key} is sparse for the derived Round`).toBeUndefined();
      } else {
        expect(stored.imageShape).toBe(shape);
        expect(stored.obverseImageFrame).toBe("rectangle");
        expect(stored.reverseImageFrame).toBe("rectangle");
      }
      // Orientation is stored only when it differs from the shape default (Bar portrait, Note landscape).
      const defaults = { bar: "portrait", note: "landscape" };
      if (orientation && orientation !== defaults[shape]) {
        expect(stored.obverseImageOrientation).toBe(orientation);
      } else {
        expect(stored.obverseImageOrientation).toBeUndefined();
      }
      expect(stored.reverseImageOrientation).toBeUndefined();

      await openEditModal(page);
      ife = editor(page);
      await expect(ife.shape.getByLabel(label)).toBeChecked();
      await expectFrame(ife.frames.nth(0), shape, orientation);
      await expectFrame(ife.frames.nth(1), shape, orientation ? defaults[shape] : null);
    });
  }

  test("D-4: a stored note on a Coin that becomes Goldback saves as sparse, with no legacy frames", async ({
    page,
  }) => {
    await seedAndGoto(page, {
      items: [
        {
          ...SEED_ITEM,
          imageShape: "note",
          obverseImageFrame: "rectangle",
          reverseImageFrame: "rectangle",
        },
      ],
    });
    await openEditModal(page);
    await page.locator("#itemType").selectOption("Goldback");
    await expectFrame(editor(page).frames.nth(0), "note", "landscape");
    await submit(page);
    const stored = await storedItem(page);
    for (const key of FRAME_KEYS) expect(stored[key], `${key} was deleted`).toBeUndefined();
  });

  test("I-8: an untouched edit of a legacy mixed circle/rectangle item leaves both legacy fields byte-identical", async ({
    page,
  }) => {
    await seedAndGoto(page, {
      items: [{ ...SEED_ITEM, obverseImageFrame: "circle", reverseImageFrame: "rectangle" }],
    });
    await openEditModal(page);
    await expectFrame(editor(page).frames.nth(0), "round");
    await submit(page);
    const stored = await storedItem(page);
    expect(stored.obverseImageFrame).toBe("circle");
    expect(stored.reverseImageFrame).toBe("rectangle");
    expect(stored.imageShape).toBeUndefined();
  });

  test("D-3: a legacy rectangle on a plain Coin opens as a Bar", async ({ page }) => {
    await seedAndGoto(page, {
      items: [{ ...SEED_ITEM, obverseImageFrame: "rectangle", reverseImageFrame: "rectangle" }],
    });
    await openEditModal(page);
    const ife = editor(page);
    await expect(ife.shape.getByLabel("Bar")).toBeChecked();
    await expectFrame(ife.frames.nth(0), "bar", "portrait");
  });

  test("edit: clicking the displayed shape of a legacy rectangle item migrates it to an explicit imageShape (Codex P2)", async ({
    page,
  }) => {
    await seedAndGoto(page, { items: [{ ...SEED_ITEM, obverseImageFrame: "rectangle" }] });
    await openEditModal(page);
    const bar = editor(page).shape.getByLabel("Bar");
    await expect(bar).toBeChecked();
    // A radio fires no change event for the option that is already selected; the click is the
    // user's explicit choice and must be persisted rather than left as a bare legacy frame.
    await bar.click();
    await submit(page);
    const stored = await storedItem(page);
    expect(stored.imageShape).toBe("bar");
    expect(stored.obverseImageFrame).toBe("rectangle");
    expect(stored.reverseImageFrame).toBe("rectangle");
  });

  test("edit: a legacy rectangle Coin keeps following Type when Type changes to Goldback (Codex P2)", async ({
    page,
  }) => {
    // The Bar shown for a legacy rectangle on a plain Coin is a display fallback, not a choice
    // (D-3): the shape was never chosen, so a Type change must still move it (AC-8.1).
    await seedAndGoto(page, { items: [{ ...SEED_ITEM, obverseImageFrame: "rectangle" }] });
    await openEditModal(page);
    const ife = editor(page);
    await expect(ife.shape.getByLabel("Bar")).toBeChecked();
    await page.locator("#itemType").selectOption("Goldback");
    await expect(ife.shape.getByLabel("Note")).toBeChecked();
    await expectFrame(ife.frames.nth(0), "note", "landscape");
    await submit(page);
    const stored = await storedItem(page);
    for (const key of FRAME_KEYS) expect(stored[key], `${key} follows Type`).toBeUndefined();
  });
});

test.describe("core/image-frame-editor — layout, themes and builder parity (STRK-427)", () => {
  test("AC-6.1: desktop previews are larger than the old 140px cap and fit the 700px dialog", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedAndGoto(page);
    await openAddModal(page);
    const ife = editor(page);
    // The approved A.1 mockup sets a 200px square bounding box (no dialog widening).
    for (const shape of ["Round", "Slab", "Bar", "Note"]) {
      await ife.shape.getByLabel(shape).check();
      for (const index of [0, 1]) {
        const box = await ife.frames.nth(index).boundingBox();
        expect(Math.max(box.width, box.height), `${shape} frame ${index}`).toBeGreaterThan(190);
        expect(Math.max(box.width, box.height)).toBeLessThanOrEqual(201);
      }
    }
    const form = await page.locator("#inventoryForm").boundingBox();
    expect(form.width).toBeLessThanOrEqual(700);
    const last = await ife.frames.nth(1).boundingBox();
    expect(last.x + last.width).toBeLessThanOrEqual(form.x + form.width);
  });

  for (const width of [768, 390]) {
    test(`AC-6.2: at ${width}px previews keep the 140px cap, the frame is the upload target and options are 44px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedAndGoto(page);
      await openAddModal(page);
      const ife = editor(page);
      await ife.shape.getByLabel("Bar").check();
      const frame = await ife.frames.nth(0).boundingBox();
      expect(Math.max(frame.width, frame.height)).toBeLessThanOrEqual(141);
      // STRK-434 replaces mobile option M-B: no button row sits under the preview any more; the
      // frame itself is the upload target, so its upload control covers the frame.
      const upload = await page.locator("#itemImageUploadBtnObv").boundingBox();
      expect(upload.x).toBeLessThanOrEqual(frame.x + 1);
      expect(upload.y).toBeLessThanOrEqual(frame.y + 1);
      expect(upload.x + upload.width).toBeGreaterThanOrEqual(frame.x + frame.width - 1);
      expect(upload.y + upload.height).toBeGreaterThanOrEqual(frame.y + frame.height - 1);
      for (const label of ["Portrait", "Landscape"]) {
        const option = await ife.orient("Obverse").getByLabel(label).locator("..").boundingBox();
        expect(option.height, `${label} option height`).toBeGreaterThanOrEqual(44);
      }
      for (const label of ["Round", "Bar", "Note", "Slab"]) {
        const option = await ife.shape.getByLabel(label).locator("..").boundingBox();
        expect(option.height, `${label} shape option height`).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      );
    });
  }

  test("AC-6.3: the editor is legible in light, dark, slate and sepia at desktop and 390px", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const ife = editor(page);
    await ife.shape.getByLabel("Bar").check();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark", "slate", "sepia"]) {
        await page.evaluate((value) => window.setTheme(value), theme);
        // The segmented options transition background and color over 150ms; sample after they settle.
        await page.waitForTimeout(300);
        // Resolve colors through a canvas so oklch() and rgb() compare alike (STRK-426 pattern).
        const report = await page.evaluate(() => {
          const ctx = document.createElement("canvas").getContext("2d", {
            willReadFrequently: true,
          });
          const rgba = (color) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
          };
          const luminance = (color) => {
            const [r, g, b] = rgba(color)
              .slice(0, 3)
              .map((c) => {
                const v = c / 255;
                return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const contrast = (a, b) => {
            const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
          };
          const frame = document.querySelector("#itemModal .ife .ife-frame");
          const frameStyle = getComputedStyle(frame);
          const group = document.querySelector("#itemModal .ife .collections-segmented");
          return {
            frameOpaque: rgba(frameStyle.backgroundColor)[3] === 255,
            groupOpaque: rgba(getComputedStyle(group).backgroundColor)[3] === 255,
            plusContrast: contrast(frameStyle.color, frameStyle.backgroundColor),
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        const label = `${theme} theme at ${width}px`;
        expect(report.frameOpaque, `${label}: frame background is a real token`).toBe(true);
        expect(report.groupOpaque, `${label}: control background is a real token`).toBe(true);
        expect(report.plusContrast, `${label}: empty-frame glyph`).toBeGreaterThanOrEqual(3);
        // The selected option's colors are the shipped .collections-segmented pairing, the same
        // control the builder has had since STRK-368, so its contrast is not this feature's to
        // assert here (it measures 2.39:1 in every theme; filed as a separate follow-up).
        expect(report.overflow, `${label}: no horizontal overflow`).toBeLessThanOrEqual(0);
      }
    }
    await page.evaluate(() => window.setTheme("light"));
  });

  test("AC-1.4: Settings → Images keeps its 140px preview cap", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedAndGoto(page);
    const cap = await page.evaluate(
      () => getComputedStyle(document.getElementById("patternRuleObversePreview")).maxHeight
    );
    expect(cap).toBe("140px");
  });

  test("B-builder: the Edit Collection builder mounts the same editor contract", async ({
    page,
  }) => {
    await seedCollectionsPage(page, [
      collectionItem("frame-ase", "2024 American Silver Eagle", "2024", 1),
    ]);
    await page.waitForFunction(() => window.appListenersReady === true && !!window.collectionsUI);
    await page.getByRole("tab", { name: "Collections", exact: true }).click();
    await page
      .locator("#collectionsSectionEl")
      .getByRole("button", { name: /New collection/ })
      .first()
      .click();
    const builder = page.locator("#collectionsBuilderModal");
    const root = builder.locator(".ife");
    await expect(root).toHaveCount(1);
    await expect(root.locator(".ife-frame")).toHaveCount(2);
    const shape = root.getByRole("radiogroup", { name: "Image shape" });
    await expect(shape).toBeVisible();
    await shape.getByLabel("Bar").check();
    await expectFrame(root.locator(".ife-frame").nth(0), "bar", "portrait");
    await root
      .getByRole("radiogroup", { name: "Reverse orientation" })
      .getByLabel("Landscape")
      .check();
    await expectFrame(root.locator(".ife-frame").nth(1), "bar", "landscape");
    await expectFrame(root.locator(".ife-frame").nth(0), "bar", "portrait");
  });
});

// STRK-434 — visual parity between the Add/Edit Item modal and the Edit collection builder.
//
// Written BEFORE the fixes (TDD red phase). The contract is measured on rendered geometry and
// computed style, never on class names, so it holds whichever markup the two hosts end up with:
//
//   1. The Images section sits below Type, Metal and Name in both modals.
//   2. The Image shape selector sits below the frames, carries no visible caption, and keeps
//      its accessible name.
//   3. The selector's options are the same size and casing in both modals, at 1280 and 390.
//   4. Swap is always rendered, disabled with an explanatory title until a side holds an image,
//      and is a transparent icon (not a filled block) readable in all four themes.
//   5. No side card draws a dashed drop-zone box.
//   6. The builder's preview medallions match the item modal's 200px box (140px cap at 390).
//   7. The Images section remembers its open/collapsed choice across modal reopen.
//   8. The side captions share one type style.
//
// CONTRACT CHANGE: Swap used to be hidden until two real images existed (STRK-427 P1) and the
// builder hid it until one side held an image. STRK-434 (decided by Lonnie, 2026-10-11) replaces
// both rules; the older "Swap is hidden" assertions above are updated in the GREEN commit.

/**
 * Waits for a modal's entrance animation so geometry is read at rest.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} modal - CSS selector of the modal root
 * @returns {Promise<void>}
 */
async function settleDialog(page, modal) {
  await page
    .locator(`${modal} .modal-content`)
    .first()
    .evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
}

/**
 * Opens the Edit collection builder on a blank collection through its production entry point.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
async function openBuilderModal(page) {
  await page.waitForFunction(() => !!window.collectionsPicker);
  await page.evaluate(() => window.collectionsPicker.openBuilder({}));
  await expect(page.locator("#collectionsBuilderModal")).toBeVisible();
  await settleDialog(page, "#collectionsBuilderModal");
}

/** Hooks that let one assertion run against both modals. */
const PARITY_HOSTS = {
  item: {
    modal: "#itemModal",
    open: openAddModal,
    close: (page) => page.locator("#cancelItem").click(),
    name: (page) => page.locator("#itemName"),
    images: (page) => page.locator("#imageUploadGroup"),
    swap: (page) => page.locator("#swapImagesBtn"),
    file: (page) => page.locator("#itemImageFileObv"),
    caption: (page) => page.locator("#imageUploadGroup").getByText(/^obverse$/i),
  },
  builder: {
    modal: "#collectionsBuilderModal",
    open: openBuilderModal,
    close: (page) =>
      page.locator("#collectionsBuilderModal").getByRole("button", { name: "Cancel" }).click(),
    name: (page) => page.locator("#collectionsBuilderModal").getByLabel("Collection name"),
    images: (page) => page.locator("#collectionsBuilderModal .ife"),
    swap: (page) =>
      page
        .locator("#collectionsBuilderModal")
        .getByRole("button", { name: "Swap obverse and reverse images" }),
    file: (page) => page.locator("#collectionsBuilderModal input[type=file]").first(),
    caption: (page) => page.locator("#collectionsBuilderModal").getByText(/^obverse title image$/i),
  },
};

/**
 * Seeds the app, opens one modal and returns the hooks for it.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {"item"|"builder"} kind - Which modal to open
 * @returns {Promise<typeof PARITY_HOSTS.item>} Hooks for that modal
 */
async function openParityHost(page, kind) {
  await seedAndGoto(page);
  const host = PARITY_HOSTS[kind];
  await host.open(page);
  return host;
}

/**
 * Computed style fields of the Bar option in the Image shape selector, plus the group height.
 * @param {import('@playwright/test').Page} page - Page under test
 * @param {string} modal - CSS selector of the modal root
 * @returns {Promise<object>} Measured size and type style
 */
const measureShapeOption = (page, modal) =>
  page.locator(`${modal} .ife`).evaluate((root) => {
    // The shape selector is the radiogroup that offers Round; orientation groups do not.
    const group = Array.from(root.querySelectorAll('[role="radiogroup"]')).find((el) =>
      /round/i.test(el.textContent)
    );
    const label = Array.from(group.querySelectorAll("label")).find((el) =>
      /bar/i.test(el.textContent)
    );
    const style = getComputedStyle(label);
    return {
      optionHeight: Math.round(label.getBoundingClientRect().height),
      groupHeight: Math.round(group.getBoundingClientRect().height),
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      textTransform: style.textTransform,
      letterSpacing: style.letterSpacing,
    };
  });

test.describe("core/image-frame-editor — item modal vs builder visual parity (STRK-434)", () => {
  for (const kind of ["item", "builder"]) {
    test(`row 6: ${kind} modal puts the Images section below Type, Metal and Name`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 1500 });
      const host = await openParityHost(page, kind);
      const name = await host.name(page).boundingBox();
      const images = await host.images(page).boundingBox();
      expect(images.y, "Images section top vs Name bottom").toBeGreaterThanOrEqual(
        name.y + name.height - 1
      );
    });

    test(`row 2: ${kind} modal puts the shape selector below the frames, with no visible caption`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 1500 });
      const host = await openParityHost(page, kind);
      const root = page.locator(`${host.modal} .ife`);
      const shape = root.getByRole("radiogroup", { name: "Image shape" });
      const group = await shape.boundingBox();
      for (const index of [0, 1]) {
        const frame = await root.locator(".ife-frame").nth(index).boundingBox();
        expect(group.y, `shape selector top vs frame ${index} bottom`).toBeGreaterThanOrEqual(
          frame.y + frame.height - 1
        );
      }
      // The selector is self-explanatory: no caption text, but screen readers still hear its name.
      await expect(root.getByText(/^image shape$/i)).toHaveCount(0);
      await expect(shape).toHaveAttribute("aria-label", "Image shape");
    });

    test(`row 5: ${kind} modal renders Swap with no image, disabled and explained, enabled once a side holds one`, async ({
      page,
    }) => {
      const host = await openParityHost(page, kind);
      const swap = host.swap(page);
      await expect(swap).toBeVisible();
      await expect(swap).toBeDisabled();
      const idleTitle = (await swap.getAttribute("title")) || "";
      expect(idleTitle).toMatch(/image/i);
      await host.file(page).setInputFiles("tests/playwright/helpers/test-obverse.png");
      await expect(swap).toBeEnabled();
      expect(await swap.getAttribute("title")).not.toBe(idleTitle);
    });

    test(`row 5: ${kind} modal Swap is a transparent icon, readable in all four themes`, async ({
      page,
    }) => {
      const host = await openParityHost(page, kind);
      const swap = host.swap(page);
      await expect(swap.locator("svg")).toHaveCount(1);
      expect(((await swap.textContent()) || "").trim()).toBe("");
      for (const theme of ["light", "dark", "slate", "sepia"]) {
        await page.evaluate((value) => window.setTheme(value), theme);
        await page.waitForTimeout(300);
        const report = await swap.evaluate((button) => {
          const style = getComputedStyle(button);
          const ctx = document.createElement("canvas").getContext("2d", {
            willReadFrequently: true,
          });
          const rgba = (color) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
          };
          const luminance = (color) => {
            const [r, g, b] = rgba(color)
              .slice(0, 3)
              .map((c) => {
                const v = c / 255;
                return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const surface = getComputedStyle(button.closest(".modal-content")).backgroundColor;
          const [hi, lo] = [luminance(style.color), luminance(surface)].sort((x, y) => y - x);
          return {
            background: rgba(style.backgroundColor)[3],
            border: parseFloat(style.borderTopWidth) || 0,
            contrast: (hi + 0.05) / (lo + 0.05),
          };
        });
        expect(report.background, `${theme} swap background alpha`).toBe(0);
        expect(report.border, `${theme} swap border width`).toBe(0);
        expect(report.contrast, `${theme} swap icon contrast`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  for (const width of [1280, 390]) {
    test(`row 3: the shape selector options are the same size and casing in both modals at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1500 });
      await seedAndGoto(page);
      await PARITY_HOSTS.item.open(page);
      const item = await measureShapeOption(page, "#itemModal");
      await PARITY_HOSTS.item.close(page);
      await expect(page.locator("#itemModal")).toBeHidden();
      await PARITY_HOSTS.builder.open(page);
      const builder = await measureShapeOption(page, "#collectionsBuilderModal");
      expect(builder).toEqual(item);
    });
  }

  test("row 1: no side card in the item modal draws a dashed drop-zone box", async ({ page }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const borders = await page
      .locator("#imageUploadGroup .image-upload-side")
      .evaluateAll((sides) => sides.map((side) => getComputedStyle(side).borderTopStyle));
    expect(borders.length).toBeGreaterThan(0);
    for (const style of borders) expect(style).not.toBe("dashed");
  });

  test("row 1: an edited item with two images shows no dashed box either", async ({ page }) => {
    await seedAndGoto(page);
    await openEditModal(page);
    const borders = await page
      .locator("#imageUploadGroup .image-upload-side")
      .evaluateAll((sides) => sides.map((side) => getComputedStyle(side).borderTopStyle));
    for (const style of borders) expect(style).not.toBe("dashed");
  });

  for (const [width, cap] of [
    [1280, 200],
    [390, 140],
  ]) {
    test(`row 4: builder medallions match the item modal's ${cap}px preview box at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1500 });
      await seedAndGoto(page);
      await PARITY_HOSTS.builder.open(page);
      const frames = page.locator("#collectionsBuilderModal .ife-frame");
      for (const index of [0, 1]) {
        const box = await frames.nth(index).boundingBox();
        const longest = Math.max(box.width, box.height);
        expect(longest, `builder frame ${index} at ${width}px`).toBeLessThanOrEqual(cap + 1);
        expect(longest, `builder frame ${index} at ${width}px`).toBeGreaterThan(cap - 10);
      }
    });
  }

  test("row 10: the Images section remembers its open or collapsed choice across modal reopen", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    const group = page.locator("#imageUploadGroup");
    await expect(group).toHaveJSProperty("open", true);
    await group.locator("summary").click();
    await expect(group).toHaveJSProperty("open", false);
    await PARITY_HOSTS.item.close(page);
    await openAddModal(page);
    await expect(group).toHaveJSProperty("open", false);
    await group.locator("summary").click();
    await expect(group).toHaveJSProperty("open", true);
    await PARITY_HOSTS.item.close(page);
    await openAddModal(page);
    await expect(group).toHaveJSProperty("open", true);
  });

  test("row 7: the side captions share one type style in both modals", async ({ page }) => {
    await seedAndGoto(page);
    const read = (locator) =>
      locator.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          textTransform: style.textTransform,
          letterSpacing: style.letterSpacing,
        };
      });
    await PARITY_HOSTS.item.open(page);
    const item = await read(PARITY_HOSTS.item.caption(page));
    await PARITY_HOSTS.item.close(page);
    await expect(page.locator("#itemModal")).toBeHidden();
    await PARITY_HOSTS.builder.open(page);
    const builder = await read(PARITY_HOSTS.builder.caption(page));
    expect(builder).toEqual(item);
  });

  // Row 8 (decided by Lonnie, 2026-10-11): the item modal takes the builder's click-to-upload
  // frame and corner × badge. External URLs stay reachable through a small link icon at the
  // frame's lower right that opens a small dialog; the builder stays file-only until a
  // follow-up issue adds URL support there.
  for (const [index, suffix] of [
    [0, "Obv"],
    [1, "Rev"],
  ]) {
    test(`row 8: clicking the ${suffix} frame opens the file chooser`, async ({ page }) => {
      await seedAndGoto(page);
      await openAddModal(page);
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        editor(page).frames.nth(index).click(),
      ]);
      expect(chooser).toBeTruthy();
    });
  }

  test("row 8: no Upload, URL or Remove text buttons sit under the frames", async ({ page }) => {
    await seedAndGoto(page);
    await openEditModal(page);
    const labels = await page
      .locator("#imageUploadGroup .image-upload-side button")
      .evaluateAll((buttons) =>
        buttons
          .filter((button) => button.getBoundingClientRect().width > 0)
          .map((button) => button.textContent.trim())
          .filter((text) => /^(upload|url|remove)$/i.test(text))
      );
    expect(labels).toEqual([]);
  });

  test("row 8: Remove is a small corner badge on the frame", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1500 });
    await seedAndGoto(page);
    await openEditModal(page);
    for (const [index, suffix] of [
      [0, "Obv"],
      [1, "Rev"],
    ]) {
      const frame = await editor(page).frames.nth(index).boundingBox();
      const badge = await page.locator(`#itemImageRemoveBtn${suffix}`).boundingBox();
      expect(badge.width, `${suffix} badge width`).toBeLessThanOrEqual(32);
      expect(badge.x, `${suffix} badge left`).toBeGreaterThanOrEqual(frame.x - 12);
      expect(badge.x + badge.width, `${suffix} badge right`).toBeLessThanOrEqual(
        frame.x + frame.width + 12
      );
      // Upper right quadrant of the frame.
      expect(badge.x + badge.width / 2).toBeGreaterThan(frame.x + frame.width / 2);
      expect(badge.y + badge.height / 2).toBeLessThan(frame.y + frame.height / 2);
    }
  });

  test("row 8: the link icon sits at the frame's lower right, icon only", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1500 });
    await seedAndGoto(page);
    await openAddModal(page);
    for (const [index, suffix] of [
      [0, "Obv"],
      [1, "Rev"],
    ]) {
      const link = page.locator(`#itemImageUrlBtn${suffix}`);
      await expect(link).toBeVisible();
      await expect(link.locator("svg")).toHaveCount(1);
      expect(((await link.textContent()) || "").trim()).toBe("");
      const frame = await editor(page).frames.nth(index).boundingBox();
      const box = await link.boundingBox();
      expect(box.width, `${suffix} link width`).toBeLessThanOrEqual(36);
      expect(box.x + box.width / 2).toBeGreaterThan(frame.x + frame.width / 2);
      expect(box.y + box.height / 2).toBeGreaterThan(frame.y + frame.height / 2);
      expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 12);
      expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 12);
    }
  });

  test("row 8: the link icon opens a small dialog; a URL entered there fills the field and previews", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openAddModal(page);
    await page.locator("#itemImageUrlBtnObv").click();
    const dialog = page.locator("#appDialogModal");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#appDialogInput")).toHaveValue("");
    await page.locator("#appDialogInput").fill("https://images.example/obv.png");
    await page.locator("#appDialogOk").click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#itemObverseImageUrl")).toHaveValue(
      "https://images.example/obv.png"
    );
    await expect(page.locator("#itemImagePreviewImgObv")).toBeVisible();
    await expect(page.locator("#swapImagesBtn")).toBeEnabled();
  });

  test("row 8: the link dialog starts from the current URL and Cancel changes nothing", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openEditModal(page);
    await page.locator("#itemImageUrlBtnRev").click();
    await expect(page.locator("#appDialogInput")).toHaveValue("https://images.example/rev.png");
    await page.locator("#appDialogInput").fill("https://images.example/other.png");
    await page.locator("#appDialogCancel").click();
    await expect(page.locator("#itemReverseImageUrl")).toHaveValue(
      "https://images.example/rev.png"
    );
  });

  test("row 8: the inline URL fields stay out of sight, even when an item has URLs", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openEditModal(page);
    await expect(page.locator("#itemObverseImageUrl")).toBeHidden();
    await expect(page.locator("#itemReverseImageUrl")).toBeHidden();
  });

  // Neither modal crops (decided by Lonnie, 2026-10-11): a photo is scaled to fit whole inside
  // the fixed-ratio frame, and a frame holding an image draws no fill or border of its own, so
  // the bands left by a mismatched photo are invisible.
  for (const kind of ["item", "builder"]) {
    for (const shape of ["Round", "Bar", "Note", "Slab"]) {
      test(`row 11: the ${kind} modal fits a photo whole in a ${shape} frame, with no fill or border`, async ({
        page,
      }) => {
        const host = await openParityHost(page, kind);
        await host.file(page).setInputFiles("tests/playwright/helpers/test-obverse.png");
        const root = page.locator(`${host.modal} .ife`);
        await root.getByRole("radiogroup", { name: "Image shape" }).getByLabel(shape).check();
        const frame = root.locator(".ife-frame").first();
        await expect(frame).toHaveClass(/has-image/);
        const report = await frame.evaluate((node) => {
          const style = getComputedStyle(node);
          const ctx = document.createElement("canvas").getContext("2d", {
            willReadFrequently: true,
          });
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = style.backgroundColor;
          ctx.fillRect(0, 0, 1, 1);
          return {
            fit: getComputedStyle(node.querySelector("img")).objectFit,
            border: parseFloat(style.borderTopWidth) || 0,
            backgroundAlpha: ctx.getImageData(0, 0, 1, 1).data[3],
          };
        });
        expect(report.fit).toBe("contain");
        expect(report.border).toBe(0);
        expect(report.backgroundAlpha).toBe(0);
      });
    }
  }
});

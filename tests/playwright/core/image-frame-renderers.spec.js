import { test, expect } from "../helpers/mocks/extended-test.js";
import {
  collectionItem as baseItem,
  seedCollectionsPage,
} from "../helpers/collections-fixtures.js";

// STRK-427 P2 (AC-9.1 to AC-9.4): the inventory table, the card views and the view modal frame
// item images with the SAME shape and orientation model the item modal and Collections use.
//
// Contract pinned here (approach.md D-17, D-18):
//   - every renderer wrapper carries data-shape ("round"|"bar"|"note"|"slab") and, for Bar and
//     Note only, data-orientation ("portrait"|"landscape"), next to the legacy classes
//     (bar-shape, table-thumb-rect, view-shape-rect), which stay;
//   - the existing wrapper box is the BOUNDING box: the frame is the largest token-ratio
//     rectangle that fits it, with object-fit: contain (never a crop) for every non-round shape;
//   - the table thumb stays 28px tall and its width is ratio-derived, clamped to 16..40px;
//   - the placeholder SVG follows the same frame;
//   - the view modal re-applies the frame after late Numista enrichment;
//   - a Custom Collection Slot keeps the COLLECTION's shape even when it shows a linked photo.

const IMAGE_URL = "https://images.example/frame.svg";

/** A plain, ungraded Coin the cases specialise. */
const coin = (uuid, serial, over = {}) => ({
  ...baseItem(uuid, `Frame ${uuid}`, "2024", serial),
  ...over,
});

const ITEMS = {
  round: coin("fr-round", 1),
  bar: coin("fr-bar", 2, { type: "Bar" }),
  note: coin("fr-note", 3, { imageShape: "note", obverseImageFrame: "rectangle" }),
  slab: coin("fr-slab", 4, { gradingAuthority: "PCGS", grade: "MS 70" }),
  legacy: coin("fr-legacy", 5, { obverseImageFrame: "rectangle" }),
};

const withImages = (item) => ({
  ...item,
  obverseImageUrl: IMAGE_URL,
  reverseImageUrl: IMAGE_URL,
  ignorePatternImages: true,
});

/**
 * Boot the Inventory tab with the given items and a routed 80x40 SVG for every image URL.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {Object[]} items - Inventory items.
 * @param {{style?: string, tableImages?: string}} [options] - Card style (D is the table) and sides.
 * @returns {Promise<void>}
 */
async function boot(page, items, { style = "D", sides = "both" } = {}) {
  await page.route("https://images.example/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#999"/></svg>',
    })
  );
  await page.addInitScript(
    ({ cardStyle, tableSides }) => {
      localStorage.setItem("cardViewStyle", cardStyle);
      localStorage.setItem("tableImageSides", tableSides);
      localStorage.setItem("tableImagesEnabled", "true");
    },
    { cardStyle: style, tableSides: sides }
  );
  await seedCollectionsPage(page, items);
  await page.waitForFunction(
    () =>
      typeof window.showViewModal === "function" &&
      typeof window.renderTable === "function" &&
      typeof window.resolveImageFrame === "function" &&
      Array.isArray(window.inventory) &&
      window.inventory.length > 0
  );
}

/**
 * Measure one element's frame: attributes, box and object-fit.
 * @param {import('@playwright/test').Locator} locator - Wrapper (or table thumb) element.
 * @param {string} [fitSelector] - Descendant whose object-fit is read (default: the element).
 * @returns {Promise<{shape: string, orientation: string, w: number, h: number, ratio: number, fit: string, className: string}>}
 */
const frameOf = (locator, fitSelector = "") =>
  locator.evaluate((element, selector) => {
    const box = element.getBoundingClientRect();
    const fitTarget = selector ? element.querySelector(selector) : element;
    return {
      shape: element.dataset.shape || "",
      orientation: element.dataset.orientation || "",
      w: box.width,
      h: box.height,
      ratio: box.width / box.height,
      fit: fitTarget ? getComputedStyle(fitTarget).objectFit : "",
      className: element.className,
    };
  }, fitSelector);

/** Token ratios the renderers must reproduce (css/styles.css :root). */
const RATIO = { round: 1, barPortrait: 0.6, noteLandscape: 2.05, slab: 0.68 };

const thumbOf = (page, uuid, side = "obverse") =>
  page.locator(`#inventoryTable img.table-thumb[data-item-uuid="${uuid}"][data-side="${side}"]`);

const cardCoinOf = (page, style, uuid, side = "obverse") =>
  page.locator(
    `.card-${style.toLowerCase()} .coin-img:has(img[data-item-uuid="${uuid}"][data-side="${side}"])`
  );

test.describe("core/image-frame-renderers (STRK-427 P2)", () => {
  test("table thumbs carry shape and orientation, stay 28px tall and clamp their width (AC-9.1)", async ({
    page,
  }) => {
    await boot(page, Object.values(ITEMS).map(withImages), { style: "D" });
    await expect(thumbOf(page, "fr-round")).toHaveCount(1);

    const round = await frameOf(thumbOf(page, "fr-round"));
    expect(round).toMatchObject({ shape: "round", orientation: "" });
    expect(Math.round(round.h)).toBe(28);
    expect(Math.round(round.w)).toBe(28);

    const bar = await frameOf(thumbOf(page, "fr-bar"));
    expect(bar).toMatchObject({ shape: "bar", orientation: "portrait", fit: "contain" });
    expect(Math.round(bar.h)).toBe(28);
    expect(bar.w).toBeGreaterThanOrEqual(16);
    expect(bar.w).toBeLessThanOrEqual(18);
    expect(bar.className).toContain("table-thumb-rect");

    const note = await frameOf(thumbOf(page, "fr-note"));
    expect(note).toMatchObject({ shape: "note", orientation: "landscape", fit: "contain" });
    expect(Math.round(note.h)).toBe(28);
    expect(Math.round(note.w)).toBe(40); // 28 * 2.05 clamps to the 40px ceiling

    const slab = await frameOf(thumbOf(page, "fr-slab"));
    expect(slab).toMatchObject({ shape: "slab", orientation: "", fit: "contain" });
    expect(Math.round(slab.h)).toBe(28);
    expect(slab.w).toBeGreaterThanOrEqual(18.5);
    expect(slab.w).toBeLessThanOrEqual(19.5);
  });

  test("the reverse thumb follows the same shape with its own orientation (AC-9.1)", async ({
    page,
  }) => {
    await boot(
      page,
      [withImages(coin("fr-mixed", 1, { type: "Bar", obverseImageOrientation: "landscape" }))],
      { style: "D" }
    );
    await expect(thumbOf(page, "fr-mixed", "reverse")).toHaveCount(1);
    const obverse = await frameOf(thumbOf(page, "fr-mixed", "obverse"));
    const reverse = await frameOf(thumbOf(page, "fr-mixed", "reverse"));
    expect(obverse).toMatchObject({ shape: "bar", orientation: "landscape" });
    expect(reverse).toMatchObject({ shape: "bar", orientation: "portrait" });
    expect(obverse.w).toBeGreaterThan(reverse.w);
  });

  test("the placeholder SVG follows the frame (AC-9.2)", async ({ page }) => {
    // No image URLs: every thumb falls back to the generated placeholder.
    await boot(page, [ITEMS.round, ITEMS.bar, ITEMS.note], { style: "D", sides: "obverse" });
    await expect(page.locator("#inventoryTable img.table-thumb-placeholder")).toHaveCount(3);

    const natural = (uuid) =>
      thumbOf(page, uuid).evaluate((img) => ({
        src: img.currentSrc || img.src,
        ratio: img.naturalWidth / img.naturalHeight,
      }));
    const round = await natural("fr-round");
    const bar = await natural("fr-bar");
    const note = await natural("fr-note");
    expect(round.src).toMatch(/^data:image\/svg\+xml/);
    expect(round.ratio).toBeCloseTo(1, 1);
    expect(bar.ratio).toBeGreaterThan(0.5);
    expect(bar.ratio).toBeLessThan(0.7);
    expect(note.ratio).toBeCloseTo(40 / 28, 1);
    expect(new Set([round.src, bar.src, note.src]).size).toBe(3);
  });

  for (const [style, box] of [
    ["A", { w: 44, h: 44 }],
    ["B", { w: 80, h: 80 }],
    ["C", { w: 80, h: 56 }],
  ]) {
    test(`card ${style}: the wrapper frame fits its box at the token ratio (AC-9.1)`, async ({
      page,
    }) => {
      await boot(page, Object.values(ITEMS).map(withImages), { style });
      await expect(cardCoinOf(page, style, "fr-bar")).toHaveCount(1);

      const cases = [
        ["fr-round", "round", "", RATIO.round, "cover"],
        ["fr-bar", "bar", "portrait", RATIO.barPortrait, "contain"],
        ["fr-note", "note", "landscape", RATIO.noteLandscape, "contain"],
        ["fr-slab", "slab", "", RATIO.slab, "contain"],
        ["fr-legacy", "bar", "portrait", RATIO.barPortrait, "contain"],
      ];
      for (const [uuid, shape, orientation, ratio, fit] of cases) {
        const frame = await frameOf(cardCoinOf(page, style, uuid), "img.cv-thumb");
        expect(frame, uuid).toMatchObject({ shape, orientation, fit });
        expect(frame.ratio, `${uuid} ratio`).toBeCloseTo(ratio, 1);
        expect(frame.w, `${uuid} width`).toBeLessThanOrEqual(box.w + 0.5);
        expect(frame.h, `${uuid} height`).toBeLessThanOrEqual(box.h + 0.5);
        // The frame is the LARGEST ratio rectangle: it touches the box on its limiting side.
        expect(Math.max(frame.w / box.w, frame.h / box.h), `${uuid} fill`).toBeGreaterThan(0.95);
      }
    });
  }

  test("the view modal frames each side from the shared reader (AC-9.1)", async ({ page }) => {
    await boot(
      page,
      [withImages(coin("fr-view", 1, { type: "Bar", obverseImageOrientation: "landscape" }))],
      { style: "D" }
    );
    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator("#viewItemModal")).toBeVisible();
    const slot = (side) => page.locator(`#viewItemModal .view-image-slot[data-side="${side}"]`);
    await expect(slot("obverse").locator("img")).toBeVisible();
    await expect(slot("reverse").locator("img")).toBeVisible();

    const obverse = await frameOf(slot("obverse"), "img");
    const reverse = await frameOf(slot("reverse"), "img");
    expect(obverse).toMatchObject({ shape: "bar", orientation: "landscape", fit: "contain" });
    expect(reverse).toMatchObject({ shape: "bar", orientation: "portrait", fit: "contain" });
    expect(obverse.className).toContain("view-shape-rect");

    const imageRatio = (side) =>
      slot(side)
        .locator("img")
        .evaluate((img) => img.getBoundingClientRect().width / img.getBoundingClientRect().height);
    expect(await imageRatio("obverse")).toBeCloseTo(1.6, 1);
    expect(await imageRatio("reverse")).toBeCloseTo(0.6, 1);
  });

  test("the view modal re-applies the frame after Numista enrichment (AC-9.1)", async ({
    page,
  }) => {
    const item = withImages(coin("fr-enrich", 1, { numistaId: "999001" }));
    await boot(page, [item], { style: "D" });
    await page.evaluate(async () => {
      await window.imageCache.init();
      await window.imageCache.cacheMetadata("999001", {
        name: "Enriched bar",
        shape: "Rectangular",
        composition: "Silver",
      });
    });
    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator("#viewItemModal")).toBeVisible();
    const slot = page.locator('#viewItemModal .view-image-slot[data-side="obverse"]');
    // The cached metadata arrives after the first paint; the frame must follow it.
    await expect(slot).toHaveAttribute("data-shape", "bar");
    await expect(slot).toHaveAttribute("data-orientation", "portrait");
    await expect(slot).toHaveClass(/view-shape-rect/);
  });

  test("a legacy rectangle item is a portrait Bar in every theme (AC-9.3)", async ({ page }) => {
    await boot(page, [withImages(ITEMS.legacy)], { style: "A" });
    for (const theme of ["light", "dark", "slate", "sepia"]) {
      await page.evaluate(
        (name) => document.documentElement.setAttribute("data-theme", name),
        theme
      );
      const frame = await frameOf(cardCoinOf(page, "A", "fr-legacy"), "img.cv-thumb");
      expect(frame, theme).toMatchObject({ shape: "bar", orientation: "portrait", fit: "contain" });
      expect(frame.ratio, `${theme} ratio`).toBeCloseTo(RATIO.barPortrait, 1);
      expect(frame.className).toContain("bar-shape");
    }
    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator("#viewItemModal")).toBeVisible();
    for (const theme of ["light", "dark", "slate", "sepia"]) {
      await page.evaluate(
        (name) => document.documentElement.setAttribute("data-theme", name),
        theme
      );
      const slot = page.locator('#viewItemModal .view-image-slot[data-side="obverse"]');
      await expect(slot, theme).toHaveAttribute("data-shape", "bar");
      await expect(slot, theme).toHaveAttribute("data-orientation", "portrait");
    }
  });

  test("the legacy classes stay next to the new attributes (D-17)", async ({ page }) => {
    await boot(page, [withImages(ITEMS.bar)], { style: "A" });
    await expect(cardCoinOf(page, "A", "fr-bar")).toHaveClass(/bar-shape/);
    await page.evaluate(() => {
      localStorage.setItem("cardViewStyle", "D");
      window.renderTable();
    });
    await expect(thumbOf(page, "fr-bar")).toHaveClass(/table-thumb-rect/);
    await page.evaluate(() => window.showViewModal(0));
    await expect(page.locator('#viewItemModal .view-image-slot[data-side="obverse"]')).toHaveClass(
      /view-shape-rect/
    );
  });

  test("a Custom Collection Slot keeps the collection's shape for a linked Item photo (AC-9.4)", async ({
    page,
  }) => {
    // The linked Item is a plain Round coin with its own photo; the collection is a Bar.
    await boot(page, [withImages(coin("fr-slot", 1))], { style: "A" });
    const id = await page.evaluate(() => {
      const created = window.collectionsStore.createCustom({
        name: "Bars with coin photos",
        imageShape: "bar",
        slots: [{ label: "Linked" }],
      });
      window.collectionsStore.link(created.collection.id, "linked", "fr-slot");
      window.collectionsUI.openCollection(created.collection.id);
      return created.collection.id;
    });
    expect(id).toBeTruthy();
    const slotCoin = page.locator(
      '#collectionsSectionEl [data-slot-id="linked"] .collections-coin'
    );
    await expect(slotCoin.locator("img")).toBeVisible();
    await expect(slotCoin).toHaveClass(/collections-coin--shape-bar/);
    await expect(slotCoin).toHaveClass(/collections-coin--portrait/);
  });
});

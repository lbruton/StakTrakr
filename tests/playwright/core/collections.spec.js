import { readFileSync } from "node:fs";
// Collections module (STRK-368, epic STRK-254) — new product domain: Collections.
//
// A Collection is a checklist over the inventory: each Slot links to Item UUIDs held on
// the Collection, never on the Item. These specs drive the real app (real Add Item modal,
// real delete funnel, real storage cleanup) rather than re-proving the pure rules already
// pinned by tests/unit/collections-core.test.js.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { installStakTrakrNetworkMocks } from "../helpers/mocks/routes.js";
import {
  collectionItem as baseItem,
  seedCollectionsPage,
  reloadCollections,
} from "../helpers/collections-fixtures.js";

const SEED = [
  baseItem("col-ase-2022-a", "2022 American Silver Eagle", "2022", 1),
  baseItem("col-ase-2022-b", "ASE 2022 (tube spare)", "2022", 2),
  baseItem("col-ase-2024", "2024 American Silver Eagle BU", "2024", 3),
  baseItem("col-maple-2024", "2024 Canadian Silver Maple Leaf", "2024", 4),
];

const seedAndGoto = (page, items = SEED) => seedCollectionsPage(page, items);

/**
 * Read one ASE Type 2 slot as plain JSON.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {string} slotId - Slot identifier.
 * @returns {Promise<{primary: string|null, spares: string[]}|null>} Link or null when untouched.
 */
const readSlot = (page, slotId) =>
  page.evaluate((id) => {
    const collection = window.collectionsStore.getState().collections["ase-type2"];
    const link = collection && collection.slots[id];
    return link ? { primary: link.primary, spares: [...link.spares] } : null;
  }, slotId);

test.describe("core/collections", () => {
  test("linking an item starts the date run and survives a reload", async ({ page }) => {
    await seedAndGoto(page);
    const result = await page.evaluate(() =>
      window.collectionsStore.link("ase-type2", "2024", "col-ase-2024")
    );
    expect(result).toEqual({ ok: true, changed: true });

    await reloadCollections(page);

    // cleanupStorage() runs on every boot and deletes unregistered keys — the link surviving
    // proves COLLECTION_STATE_KEY is allow-listed, not merely written.
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });
    const progress = await page.evaluate(() => {
      const store = window.collectionsStore;
      return store.progress(store.getState().collections["ase-type2"]);
    });
    expect(progress).toEqual({ owned: 1, total: 6, missing: 5, pct: 17 });
  });

  test("an item fills at most one slot per collection", async ({ page }) => {
    await seedAndGoto(page);
    const results = await page.evaluate(() => {
      const store = window.collectionsStore;
      return [
        store.link("ase-type2", "2022", "col-ase-2022-a"),
        store.link("ase-type2", "2023", "col-ase-2022-a"),
      ];
    });
    expect(results[0]).toEqual({ ok: true, changed: true });
    expect(results[1]).toEqual({
      ok: false,
      changed: false,
      reason: "already-linked",
      slotId: "2022",
    });
    expect(await readSlot(page, "2023")).toBeNull();
  });

  test("Add new item from a slot opens Add Item prefilled and auto-links on save", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.collectionsStore.requestNewItem("ase-type2", "2023"));

    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemName")).toHaveValue("2023 American Silver Eagle");
    await expect(page.locator("#itemYear")).toHaveValue("2023");
    await expect(page.locator("#itemMetal")).toHaveValue("Silver");
    await expect(page.locator("#itemType")).toHaveValue("Coin");
    await expect(page.locator("#itemWeight")).toHaveValue("1");

    await page.fill("#itemPrice", "33.40");
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).toBeHidden();

    const created = await page.evaluate(() => {
      const item = window.inventory.find((entry) => entry.name === "2023 American Silver Eagle");
      return item ? { uuid: item.uuid, year: item.year, metal: item.metal } : null;
    });
    expect(created).toMatchObject({ year: "2023", metal: "Silver" });
    expect(await readSlot(page, "2023")).toEqual({ primary: created.uuid, spares: [] });
  });

  test("the 2021 slot prefills the Type 2 item name", async ({ page }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.collectionsStore.requestNewItem("ase-type2", "2021-t2"));
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemName")).toHaveValue("2021 American Silver Eagle Type 2");
    await expect(page.locator("#itemYear")).toHaveValue("2021");
  });

  test("cancelling Add Item drops the pending slot, so a later unrelated add links nothing", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.collectionsStore.requestNewItem("ase-type2", "2025"));
    await expect(page.locator("#itemModal")).toBeVisible();
    await page.click("#cancelItem");
    await expect(page.locator("#itemModal")).toBeHidden();
    expect(await page.evaluate(() => window.collectionsStore.hasPendingNewItem())).toBe(false);

    // An ordinary Add Item afterwards must not inherit the abandoned slot request.
    await page.click("#newItemBtn");
    await expect(page.locator("#itemModal")).toBeVisible();
    await page.selectOption("#itemMetal", "Silver");
    await page.selectOption("#itemType", "Coin");
    await page.fill("#itemName", "Unrelated Silver Round");
    await page.fill("#itemWeight", "1");
    await page.fill("#itemPrice", "29");
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).toBeHidden();

    expect(
      await page.evaluate(() =>
        window.inventory.some((entry) => entry.name === "Unrelated Silver Round")
      )
    ).toBe(true);
    expect(await readSlot(page, "2025")).toBeNull();
  });

  test("closing Add Item by any other path also drops the pending slot", async ({ page }) => {
    await seedAndGoto(page);
    await page.evaluate(() => window.collectionsStore.requestNewItem("ase-type2", "2025"));
    await expect(page.locator("#itemModal")).toBeVisible();
    expect(await page.evaluate(() => window.collectionsStore.hasPendingNewItem())).toBe(true);

    // Not closeItemModal(): the bare modal helper, as a backdrop or Escape handler would call it.
    await page.evaluate(() => window.closeModalById("itemModal"));
    await expect(page.locator("#itemModal")).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.collectionsStore.hasPendingNewItem()))
      .toBe(false);
  });

  test("deleting a linked item prunes its slot and promotes the spare", async ({ page }) => {
    await seedAndGoto(page);
    await page.evaluate(() => {
      const store = window.collectionsStore;
      store.link("ase-type2", "2022", "col-ase-2022-a");
      store.link("ase-type2", "2022", "col-ase-2022-b", { asSpare: true });
    });
    expect(await readSlot(page, "2022")).toEqual({
      primary: "col-ase-2022-a",
      spares: ["col-ase-2022-b"],
    });

    // The app's own delete funnel: remove modal → confirmRemoveItem → _deleteInventoryItem.
    await page.evaluate(() => {
      const index = window.inventory.findIndex((entry) => entry.uuid === "col-ase-2022-a");
      window.openRemoveItemModal(index, false);
    });
    await expect(page.locator("#removeItemModal")).toBeVisible();
    await page.evaluate(() => window.confirmRemoveItem());
    await expect(page.locator("#removeItemModal")).toBeHidden();

    expect(
      await page.evaluate(() => window.inventory.some((entry) => entry.uuid === "col-ase-2022-a"))
    ).toBe(false);
    expect(await readSlot(page, "2022")).toEqual({ primary: "col-ase-2022-b", spares: [] });
  });

  test("a disposed item stops counting, and its link returns when the disposition is undone", async ({
    page,
  }) => {
    await seedAndGoto(page);
    /** @returns {Promise<number>} Number of owned ASE Type 2 slots. */
    const readProgress = () =>
      page.evaluate(() => {
        const store = window.collectionsStore;
        return store.progress(store.getState().collections["ase-type2"]).owned;
      });
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2024", "col-ase-2024"));
    expect(await readProgress()).toBe(1);

    const itemRow = page.locator('#inventoryTable tbody tr[data-idx="2"]');
    await expect(itemRow).toContainText("2024 American Silver Eagle BU");
    await itemRow.getByRole("button", { name: "Delete item" }).click();
    await expect(page.locator("#removeItemModal")).toBeVisible();
    await page.locator('.dispose-toggle-card[for="removeItemDisposeCheck"]').click();
    await expect(page.locator("#removeItemDisposeCheck")).toBeChecked();
    await page.locator("#dispositionDate").fill("2026-09-01");
    await page.locator("#dispositionAmount").fill("70");
    await page.locator("#removeItemDisposeBtn").click();
    await expect(page.locator("#removeItemModal")).toBeHidden();
    await expect.poll(readProgress).toBe(0);
    // Disposal never rewrites the stored link — that is what lets an undo restore the slot.
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });
    await reloadApp(page);
    expect(await readProgress()).toBe(0);
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });

    await page.locator('#disposedFilterGroup [data-disposed-mode="show-only"]').click();
    const disposedRow = page.locator('#inventoryTable tbody tr[data-idx="2"]');
    await expect(disposedRow).toContainText("2024 American Silver Eagle BU");
    await disposedRow.getByRole("button", { name: "Undo disposition" }).click();
    await expect(page.locator("#appDialogModal")).toBeVisible();
    await page.locator("#appDialogOk").click();
    await expect.poll(readProgress).toBe(1);
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });
    await reloadApp(page);
    expect(await readProgress()).toBe(1);
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });
  });
});

// -----------------------------------------------------------------------------
// Tab UI (js/collections-ui.js): hub, in-page album, album/ledger view toggle.
// Everything below asserts what a user sees in #collectionsSectionEl; the store is
// only used to ARRANGE state (link an item) so each case starts from a known album.
// -----------------------------------------------------------------------------

const ASE = "ase-type2";

/**
 * Locate the Collections panel for scoped UI assertions.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {import('@playwright/test').Locator} Collections panel.
 */
const panel = (page) => page.locator("#collectionsSectionEl");

/**
 * Locate one slot in the open album, tile or ledger row alike.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {string} slotId - Slot identifier.
 * @returns {import('@playwright/test').Locator} Matching slot.
 */
const slotOf = (page, slotId) => panel(page).locator(`[data-slot-id="${slotId}"]`);

const LONG_SLOT_NOTE =
  "First-year proof strike with a bright mirrored field, frosted devices, and a small production run. " +
  "Keep this complete collecting note available without letting it push the linked Item or the other " +
  "Slots out of alignment while comparing the collection.";

/**
 * Wait for the boot signal the Collections UI renders on.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<import('@playwright/test').JSHandle>} Boot readiness result.
 */
const waitForApp = (page) =>
  page.waitForFunction(() => window.appListenersReady === true && !!window.collectionsUI);

/**
 * Reload and wait for the UI layer specifically. Distinct from the shared
 * reloadCollections(), which only needs the store — the UI cases must not race
 * collections-ui.js (PR 1500 review — duplication).
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>}
 */
const reloadApp = async (page) => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
};

/**
 * Switch to the Collections tab through the desktop header nav.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>} When the panel is visible.
 */
const openCollectionsTab = async (page) => {
  await waitForApp(page);
  await page.getByRole("tab", { name: "Collections", exact: true }).click();
  await expect(panel(page)).toBeVisible();
};

/**
 * Link seeded items to slots through the collection store.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {Array<[string, string]>} pairs - Slot IDs and item UUIDs.
 * @returns {Promise<Array<object>>} Results of the link operations.
 */
const linkItems = (page, pairs) =>
  page.evaluate(
    ({ id, links }) =>
      links.map(([slotId, uuid]) => window.collectionsStore.link(id, slotId, uuid)),
    { id: ASE, links: pairs }
  );

/**
 * Open the ASE Type 2 album from the hub.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>} When the album heading is visible.
 */
const openAseAlbum = async (page) => {
  await panel(page).locator(`[data-collection-id="${ASE}"]`).click();
  await expect(panel(page).getByRole("heading", { name: /American Silver Eagle/ })).toBeVisible();
};

/**
 * Create a two-Slot custom collection with a long note and a blank-note control case.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<{collectionId: string, slotId: string, blankSlotId: string}>} Fixture IDs.
 */
const createSlotNoteFixture = async (page) => {
  await seedAndGoto(page);
  await openCollectionsTab(page);
  return page.evaluate((note) => {
    const created = window.collectionsStore.createCustom({
      name: "Slot note fixture",
      metal: "Silver",
      slots: [
        { label: "Proof strike", year: "2024", note },
        { label: "Blank note", year: "2025", note: "" },
      ],
    });
    if (!created.ok) throw new Error(`Fixture creation failed: ${created.reason}`);
    const [namedSlot, blankSlot] = created.collection.definition.slots;
    window.collectionsStore.link(created.collection.id, namedSlot.id, "col-maple-2024");
    window.collectionsUI.openCollection(created.collection.id);
    return {
      collectionId: created.collection.id,
      slotId: namedSlot.id,
      blankSlotId: blankSlot.id,
    };
  }, LONG_SLOT_NOTE);
};

/**
 * Fingerprint the displayed image rather than its disposable blob URL.
 * @param {import('@playwright/test').Locator} image - Image locator.
 * @returns {Promise<string|null>} SHA-256 hex digest, or null before image load.
 */
const displayedImageHash = (image) =>
  image.evaluate(async (img) => {
    if (!img.complete || !img.naturalWidth) return null;
    const bytes = await (await fetch(img.currentSrc || img.src)).arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });

test.describe("core/collections — STRK-376 saved image swaps", () => {
  test("Save waits for an image swap still reading its source", async ({ page }) => {
    await seedAndGoto(page);
    await page.evaluate(async () => {
      const blobs = await Promise.all(
        ["obverse", "reverse"].map(async (side) =>
          (await fetch(`/tests/playwright/helpers/test-${side}.png`)).blob()
        )
      );
      if (!(await window.imageCache.cacheUserImage("col-ase-2024", ...blobs)))
        throw new Error("Image fixture save failed");
    });
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openAseAlbum(page);
    await page.evaluate(() =>
      window.editItem(window.inventory.findIndex((item) => item.uuid === "col-ase-2024"))
    );
    await expect(page.locator("#swapImagesBtn")).toBeVisible();
    const reverse = page.locator("#itemImagePreviewImgRev");
    await expect.poll(() => displayedImageHash(reverse)).not.toBeNull();
    const expected = await displayedImageHash(reverse);
    // Hold the source read so a user's immediate Save reaches the form while Swap is pending.
    await page.evaluate(() => {
      const original = window.imageCache.getUserImage.bind(window.imageCache);
      window.imageCache.getUserImage = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 750));
        return original(...args);
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, ...args) => {
        if (String(input).startsWith("blob:"))
          await new Promise((resolve) => setTimeout(resolve, 750));
        return originalFetch(input, ...args);
      };
    });
    await page.locator("#swapImagesBtn").click();
    await page.locator("#itemModalSubmit").click();
    await page.locator("#inventoryForm").evaluate((form) => form.requestSubmit());
    await expect(page.locator("#itemModal")).toBeHidden();
    await reloadApp(page);
    expect(await page.evaluate(() => window.inventory.length)).toBe(SEED.length);
    await page.evaluate(() =>
      window.editItem(window.inventory.findIndex((item) => item.uuid === "col-ase-2024"))
    );
    await expect
      .poll(() => displayedImageHash(page.locator("#itemImagePreviewImgObv")))
      .toBe(expected);
  });

  test("canceling a pending swap cannot alter the next Item", async ({ page }) => {
    await seedAndGoto(page);
    await page.evaluate(() =>
      window.editItem(window.inventory.findIndex((item) => item.uuid === "col-ase-2024"))
    );
    await expect(page.locator("#swapImagesBtn")).toBeVisible();
    const image = page.locator("#itemImagePreviewImgObv");
    await expect.poll(() => displayedImageHash(image)).not.toBeNull();
    const before = await displayedImageHash(image);
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      const gate = new Promise((resolve) => {
        window.__releaseImageSwap = resolve;
      });
      window.fetch = async (input, ...args) => {
        if (String(input).startsWith("blob:")) await gate;
        return originalFetch(input, ...args);
      };
    });
    await page.locator("#swapImagesBtn").click();
    await page.evaluate(() => {
      window.__imageSwapOperation = _pendingItemImageSwap;
    });
    await expect(page.locator("#imageUploadGroup")).toHaveAttribute("inert", "");
    await page.locator("#cancelItem").click();
    await page.evaluate(() =>
      window.editItem(window.inventory.findIndex((item) => item.uuid === "col-ase-2022-a"))
    );
    await page.evaluate(async () => {
      window.__releaseImageSwap();
      await window.__imageSwapOperation;
    });
    await expect(page.locator("#imageUploadGroup")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#itemName")).toHaveValue("2022 American Silver Eagle");
    await expect.poll(() => displayedImageHash(image)).toBe(before);
    await page.locator("#itemModalSubmit").click();
    await expect(page.locator("#itemModal")).toBeHidden();
    await reloadApp(page);
    await page.evaluate(() =>
      window.editItem(window.inventory.findIndex((item) => item.uuid === "col-ase-2022-a"))
    );
    await expect.poll(() => displayedImageHash(image)).toBe(before);
  });

  for (const source of ["uploads", "URLs", "pattern images", "upload + URL", "upload + pattern"]) {
    test(`swapping ${source} survives Save, reopening, and reload`, async ({ page }, testInfo) => {
      await seedAndGoto(page);
      await page.evaluate(async (kind) => {
        const item = window.inventory.find((entry) => entry.uuid === "col-ase-2024");
        const obverse = new URL("/tests/playwright/helpers/test-obverse.png", location.href).href;
        const reverse = new URL("/tests/playwright/helpers/test-reverse.png", location.href).href;
        if (kind === "uploads" || kind.startsWith("upload +")) {
          const [obv, rev] = await Promise.all(
            [obverse, reverse].map(async (url) => (await fetch(url)).blob())
          );
          if (
            !(await window.imageCache.cacheUserImage(
              item.uuid,
              obv,
              kind === "uploads" ? rev : null
            ))
          )
            throw new Error("Image fixture save failed");
          if (kind === "upload + URL") {
            item.reverseImageUrl = reverse;
            saveInventory();
          }
        } else if (kind === "URLs") {
          item.obverseImageUrl = obverse;
          item.reverseImageUrl = reverse;
          item.ignorePatternImages = true;
          saveInventory();
        }
      }, source);
      await openCollectionsTab(page);
      await linkItems(page, [["2024", "col-ase-2024"]]);
      if (source === "pattern images") await linkItems(page, [["2022", "col-ase-2022-a"]]);
      await openAseAlbum(page);
      /**
       * Open the linked item in Edit and optionally check both displayed image hashes.
       * @param {{obverse: string, reverse: string}} [expected] - Expected image hashes.
       * @returns {Promise<void>} When the edit modal is ready.
       */
      const openEdit = async (expected) => {
        await slotOf(page, "2024")
          .getByRole("button", { name: /2024 American Silver Eagle BU/ })
          .click();
        if (expected) {
          for (const side of ["obverse", "reverse"]) {
            const viewImage = page.locator(
              `#viewImageSection .view-image-slot[data-side="${side}"] img`
            );
            await expect(viewImage).toBeVisible();
            await expect.poll(() => displayedImageHash(viewImage)).toBe(expected[side]);
          }
        }
        await page
          .locator("#viewItemModal")
          .getByRole("button", { name: "Edit", exact: true })
          .click();
        await expect(page.locator("#swapImagesBtn")).toBeVisible();
      };
      await openEdit();
      const obv = page.locator("#itemImagePreviewImgObv");
      const rev = page.locator("#itemImagePreviewImgRev");
      await expect.poll(() => displayedImageHash(obv)).not.toBeNull();
      await expect.poll(() => displayedImageHash(rev)).not.toBeNull();
      const before = {
        obverse: await displayedImageHash(obv),
        reverse: await displayedImageHash(rev),
      };
      const swapped = { obverse: before.reverse, reverse: before.obverse };
      expect(before.obverse).not.toBe(before.reverse);
      await page.locator("#swapImagesBtn").click();
      await expect.poll(() => displayedImageHash(obv)).toBe(before.reverse);
      await expect.poll(() => displayedImageHash(rev)).toBe(before.obverse);
      await page.locator("#itemModalSubmit").click();
      await expect(page.locator("#itemModal")).toBeHidden();
      await expect
        .poll(() => displayedImageHash(slotOf(page, "2024").locator(".collections-coin img")))
        .toBe(before.reverse);
      if (source === "pattern images") {
        await expect
          .poll(() => displayedImageHash(slotOf(page, "2022").locator(".collections-coin img")))
          .toBe(before.obverse);
      }
      await openEdit(swapped);
      await expect.poll(() => displayedImageHash(obv)).toBe(before.reverse);
      await expect.poll(() => displayedImageHash(rev)).toBe(before.obverse);
      await page.locator("#cancelItem").click();
      await reloadApp(page);
      await openEdit(swapped);
      await expect.poll(() => displayedImageHash(obv)).toBe(before.reverse);
      await expect.poll(() => displayedImageHash(rev)).toBe(before.obverse);
      if (source === "pattern images") {
        await testInfo.attach("saved-pattern-swap-after-reload", {
          body: await page.locator("#imageUploadGroup").screenshot(),
          contentType: "image/png",
        });
      }
    });
  }
});

test.describe("core/collections — link picker, builder, item view", () => {
  /**
   * Locate the collection link picker modal.
   * @param {import('@playwright/test').Page} page - Browser page.
   * @returns {import('@playwright/test').Locator} Picker modal.
   */
  const pickerModal = (page) => page.locator("#collectionsPickerModal");
  /**
   * Locate the collection builder modal.
   * @param {import('@playwright/test').Page} page - Browser page.
   * @returns {import('@playwright/test').Locator} Builder modal.
   */
  const builderModal = (page) => page.locator("#collectionsBuilderModal");
  /**
   * Locate the item view modal.
   * @param {import('@playwright/test').Page} page - Browser page.
   * @returns {import('@playwright/test').Locator} Item view modal.
   */
  const viewModal = (page) => page.locator("#viewItemModal");

  /**
   * Open the item view modal for a seeded item by UUID.
   * @param {import('@playwright/test').Page} page - Browser page.
   * @param {string} uuid - Item identifier.
   * @returns {Promise<void>} When the modal is visible.
   */
  const openItemView = async (page, uuid) => {
    await page.evaluate((id) => {
      window.showViewModal(window.inventory.findIndex((entry) => entry.uuid === id));
    }, uuid);
    await expect(viewModal(page)).toBeVisible();
  };

  test("Add → Link existing item opens the picker with the match pinned, and linking fills the tile", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await openAseAlbum(page);
    await slotOf(page, "2024").getByRole("button", { name: /Add/ }).click();
    await page.getByText("Link existing item").click();

    await expect(pickerModal(page)).toBeVisible();
    await expect(pickerModal(page).getByRole("heading")).toContainText("2024 slot");
    const suggested = pickerModal(page).locator(".collections-pick.is-suggested");
    await expect(suggested).toHaveCount(1);
    await expect(suggested).toContainText("2024 American Silver Eagle BU");
    await expect(suggested).toContainText("name match + year match");
    // Same year and metal, wrong series: offered in the full list, never suggested.
    await expect(
      pickerModal(page).locator('.collections-pick[data-uuid="col-maple-2024"]:not(.is-suggested)')
    ).toBeVisible();

    await suggested.getByRole("button", { name: /Link/ }).click();
    await expect(pickerModal(page)).toBeHidden();
    await expect(slotOf(page, "2024")).toContainText("2024 American Silver Eagle BU");
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });
  });

  test("the picker disables items already used in this collection and never lists disposed items", async ({
    page,
  }) => {
    await seedAndGoto(
      page,
      SEED.map((item) =>
        item.uuid === "col-maple-2024"
          ? {
              ...item,
              disposition: { type: "sold", date: "2026-09-01", amount: 40, currency: "USD" },
            }
          : item
      )
    );
    await openCollectionsTab(page);
    await linkItems(page, [["2022", "col-ase-2022-a"]]);
    await page.evaluate(() =>
      window.collectionsPicker.openLinkPicker({ collectionId: "ase-type2", slotId: "2023" })
    );

    await expect(pickerModal(page)).toBeVisible();
    // STRK-398: a dated slot opens filtered to its year; widen it to reach the 2022 item.
    await pickerModal(page).getByRole("button", { name: "All items" }).click();
    await expect(pickerModal(page)).toContainText("No obvious match for the 2023 slot");
    const used = pickerModal(page).locator('.collections-pick[data-uuid="col-ase-2022-a"]');
    await expect(used).toContainText("in 2022 slot");
    await expect(used.getByRole("button")).toHaveCount(0);
    await expect(
      pickerModal(page).locator('.collections-pick[data-uuid="col-maple-2024"]')
    ).toHaveCount(0);
  });

  test("the picker search narrows the list, and Add a new item instead hands off to Add Item", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await page.evaluate(() =>
      window.collectionsPicker.openLinkPicker({ collectionId: "ase-type2", slotId: "2023" })
    );
    // STRK-398: a dated slot opens filtered to its year; widen it to search the 2024 Maple.
    await pickerModal(page).getByRole("button", { name: "All items" }).click();
    await pickerModal(page).getByRole("searchbox").fill("maple");
    await expect(pickerModal(page).locator(".collections-pick")).toHaveCount(1);
    await expect(pickerModal(page).locator(".collections-pick")).toContainText(
      "Canadian Silver Maple Leaf"
    );

    await pickerModal(page)
      .getByRole("button", { name: /Add a new item instead/ })
      .click();
    await expect(pickerModal(page)).toBeHidden();
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemName")).toHaveValue("2023 American Silver Eagle");
  });

  test("an item entered in grams is offered for its year slot, and the picker shows its weight in grams", async ({
    page,
  }) => {
    // STRK-398 AC1: item.weight is stored in troy oz whatever the display unit, so a 31.1 g
    // coin is stored as 0.999984 — the shape parseWeight writes on save.
    await seedAndGoto(
      page,
      SEED.map((item) =>
        item.uuid === "col-ase-2024" ? { ...item, weight: 0.999984, weightUnit: "g" } : item
      )
    );
    await openCollectionsTab(page);
    await openAseAlbum(page);
    await expect(slotOf(page, "2024")).toContainText("1 match in your inventory");

    await page.evaluate(() =>
      window.collectionsPicker.openLinkPicker({ collectionId: "ase-type2", slotId: "2024" })
    );
    const suggested = pickerModal(page).locator(".collections-pick.is-suggested");
    await expect(suggested).toHaveCount(1);
    await expect(suggested).toContainText("2024 American Silver Eagle BU");
    await expect(suggested).toContainText("31.1");
    await expect(suggested).not.toContainText("0.999984");
  });

  test("the picker opens filtered to a dated slot's year, and All items widens it", async ({
    page,
  }) => {
    // STRK-398 AC4
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await page.evaluate(() =>
      window.collectionsPicker.openLinkPicker({ collectionId: "ase-type2", slotId: "2024" })
    );
    const onlyYear = pickerModal(page).getByRole("button", { name: "2024 only" });
    const allItems = pickerModal(page).getByRole("button", { name: "All items" });
    const row = (uuid) => pickerModal(page).locator(`.collections-pick[data-uuid="${uuid}"]`);

    await expect(onlyYear).toHaveAttribute("aria-pressed", "true");
    await expect(allItems).toHaveAttribute("aria-pressed", "false");
    await expect(pickerModal(page).locator(".collections-pick").first()).toHaveClass(
      /is-suggested/
    );
    await expect(row("col-ase-2024")).toBeVisible();
    await expect(row("col-maple-2024")).toBeVisible();
    await expect(row("col-ase-2022-a")).toHaveCount(0);
    await expect(row("col-ase-2022-b")).toHaveCount(0);

    await allItems.click();
    await expect(allItems).toHaveAttribute("aria-pressed", "true");
    await expect(onlyYear).toHaveAttribute("aria-pressed", "false");
    await expect(pickerModal(page).locator(".collections-pick").first()).toHaveClass(
      /is-suggested/
    );
    await expect(row("col-ase-2022-a")).toBeVisible();
    await expect(row("col-ase-2022-b")).toBeVisible();

    await onlyYear.click();
    await expect(row("col-ase-2022-a")).toHaveCount(0);
  });

  test("an undated slot's picker lists every active item with no year filter", async ({ page }) => {
    // STRK-398 AC4: custom checklist slots carry no year, so nothing is filtered.
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await page.evaluate(() => {
      const made = window.collectionsStore.createCustom({
        name: "Undated set",
        metal: "Silver",
        slots: [{ label: "Any" }],
      });
      window.collectionsPicker.openLinkPicker({ collectionId: made.collection.id, slotId: "any" });
    });
    await expect(pickerModal(page)).toBeVisible();
    await expect(pickerModal(page).getByRole("button", { name: "All items" })).toHaveCount(0);
    await expect(pickerModal(page).locator(".collections-pick")).toHaveCount(SEED.length);
  });

  test("New collection builds a custom checklist with stable slot ids and opens its album", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await panel(page)
      .getByRole("button", { name: /New collection/ })
      .first()
      .click();
    await expect(builderModal(page)).toBeVisible();

    await builderModal(page).getByLabel("Collection name").fill("Morgan Dollars — Carson City");
    const labels = builderModal(page).getByLabel("Slot label");
    await labels.nth(0).fill("1881-CC");
    await labels.nth(1).fill("1882-CC");
    // The third starter row is left blank on purpose: unlabelled rows are dropped, not saved.
    await builderModal(page).getByRole("button", { name: "Create collection" }).click();
    await expect(builderModal(page)).toBeHidden();

    const created = await page.evaluate(() => {
      const list = window.collectionsCore.listCollections(window.collectionsStore.getState());
      const custom = list.find((entry) => entry.kind === "custom");
      return custom
        ? { name: custom.name, slotIds: custom.definition.slots.map((slot) => slot.id) }
        : null;
    });
    expect(created).toEqual({
      name: "Morgan Dollars — Carson City",
      slotIds: ["1881-cc", "1882-cc"],
    });
    await expect(
      panel(page).getByRole("heading", { name: /Morgan Dollars — Carson City/ })
    ).toBeVisible();
    await expect(panel(page)).toContainText("1881-CC");
  });

  test("Clone & customize copies the template's slots into a new custom collection", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await openAseAlbum(page);
    await panel(page).getByRole("button", { name: /Clone/ }).click();
    await expect(builderModal(page)).toBeVisible();
    await expect(builderModal(page).getByLabel("Slot label")).toHaveCount(6);
    await expect(builderModal(page).getByLabel("Slot label").first()).toHaveValue("2021 T2");

    await builderModal(page).getByRole("button", { name: "Create collection" }).click();
    await expect(builderModal(page)).toBeHidden();
    const clone = await page.evaluate(() => {
      const list = window.collectionsCore.listCollections(window.collectionsStore.getState());
      const custom = list.find((entry) => entry.kind === "custom");
      return custom
        ? { clonedFrom: custom.clonedFrom, slots: custom.definition.slots.length }
        : null;
    });
    expect(clone).toEqual({ clonedFrom: "ase-type2", slots: 6 });
  });

  test("editing a custom collection renames a slot without dropping its link", async ({ page }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    const id = await page.evaluate(() => {
      const made = window.collectionsStore.createCustom({
        name: "Type set",
        metal: "Silver",
        slots: [{ label: "Alpha" }, { label: "Beta" }],
      });
      window.collectionsStore.link(made.collection.id, "alpha", "col-maple-2024");
      window.collectionsPicker.openBuilder({ editId: made.collection.id });
      return made.collection.id;
    });

    await expect(builderModal(page)).toBeVisible();
    await builderModal(page).getByLabel("Slot label").first().fill("Alpha (renamed)");
    await builderModal(page).getByRole("button", { name: "Save changes" }).click();
    await expect(builderModal(page)).toBeHidden();

    const after = await page.evaluate((collectionId) => {
      const collection = window.collectionsStore.getState().collections[collectionId];
      return {
        first: collection.definition.slots[0],
        linked: collection.slots.alpha.primary,
      };
    }, id);
    expect(after.first).toMatchObject({ id: "alpha", label: "Alpha (renamed)" });
    expect(after.linked).toBe("col-maple-2024");
  });

  test("a Custom Collection side choice persists and drives reverse images plus Slot notes", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const id = await page.evaluate(() => {
      const item = window.inventory.find((entry) => entry.uuid === "col-maple-2024");
      item.obverseImageUrl = new URL(
        "/tests/playwright/helpers/test-obverse.png",
        location.href
      ).href;
      item.reverseImageUrl = new URL(
        "/tests/playwright/helpers/test-reverse.png",
        location.href
      ).href;
      item.ignorePatternImages = true;
      saveInventory();
      const created = window.collectionsStore.createCustom({
        name: "Reverse artwork",
        slots: [{ label: "Maple", note: "Key date" }],
      });
      window.collectionsStore.link(created.collection.id, "maple", item.uuid);
      window.collectionsUI.openCollection(created.collection.id);
      window.collectionsPicker.openBuilder({ editId: created.collection.id });
      return created.collection.id;
    });

    const builder = builderModal(page);
    await builder.getByLabel("Coin side").selectOption("reverse");
    await builder.getByRole("button", { name: "Save changes" }).click();
    await expect(slotOf(page, "maple").locator(".collections-coin img")).toHaveAttribute(
      "src",
      /test-reverse\.png$/
    );
    const albumNote = slotOf(page, "maple").getByRole("button", { name: "Show note for Maple" });
    await expect(albumNote).toHaveAttribute("aria-expanded", "false");
    await albumNote.click();
    await expect(page.getByRole("region", { name: "Note for Maple" })).toHaveText("Key date");

    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    const ledgerNote = slotOf(page, "maple").getByRole("button", { name: "Show note for Maple" });
    await ledgerNote.click();
    await expect(page.getByRole("region", { name: "Note for Maple" })).toHaveText("Key date");
    await reloadApp(page);
    expect(
      await page.evaluate(
        (collectionId) =>
          window.collectionsStore.getState().collections[collectionId].definition.side,
        id
      )
    ).toBe("reverse");
    await expect(slotOf(page, "maple").locator(".collections-coin img")).toHaveAttribute(
      "src",
      /test-reverse\.png$/
    );
    await slotOf(page, "maple").getByRole("button", { name: "Show note for Maple" }).click();
    await expect(page.getByRole("region", { name: "Note for Maple" })).toHaveText("Key date");
  });

  test("long Slot notes stay compact and keyboard reachable in Album cards", async ({
    page,
  }, testInfo) => {
    const { slotId, blankSlotId } = await createSlotNoteFixture(page);
    const card = slotOf(page, slotId);
    const identity = card.locator(".collections-slot-identity");
    const noteButton = card.getByRole("button", { name: "Show note for Proof strike" });

    await expect(identity.locator(".collections-slot-identity-name")).toContainText("Proof strike");
    await expect(identity.locator(".collections-slot-identity-year")).toHaveText("2024");
    await expect(noteButton).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("region", { name: "Note for Proof strike" })).toBeHidden();
    await expect(slotOf(page, blankSlotId).locator(".collections-note-toggle")).toHaveCount(0);
    const identityBox = await identity.boundingBox();
    const noteButtonBox = await noteButton.boundingBox();
    expect(
      Math.abs(identityBox.y + identityBox.height / 2 - noteButtonBox.y - noteButtonBox.height / 2)
    ).toBeLessThan(28);
    const cardHeight = await card.evaluate((element) => element.getBoundingClientRect().height);

    await noteButton.focus();
    await page.keyboard.press("Enter");
    const popover = page.getByRole("region", { name: "Note for Proof strike" });
    await expect(popover).toHaveText(LONG_SLOT_NOTE);
    await expect(noteButton).toHaveAttribute("aria-expanded", "true");
    expect(await card.evaluate((element) => element.getBoundingClientRect().height)).toBe(
      cardHeight
    );
    await page.screenshot({ path: testInfo.outputPath("strk-399-album-desktop.png") });

    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(noteButton).toHaveAttribute("aria-expanded", "false");
    await expect(noteButton).toBeFocused();

    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(popover).toBeHidden();
    await expect(noteButton).toHaveAttribute("aria-expanded", "false");

    await noteButton.click();
    await page.getByRole("button", { name: "Collections" }).click();
    await expect(popover).toBeHidden();
  });

  test("long Slot notes stay compact beside Ledger identity and linked Items", async ({
    page,
  }, testInfo) => {
    const { slotId, blankSlotId } = await createSlotNoteFixture(page);
    await panel(page).getByRole("button", { name: "Ledger view" }).click();

    const row = slotOf(page, slotId);
    const identity = row.locator(".collections-slot-identity");
    const noteButton = row.getByRole("button", { name: "Show note for Proof strike" });
    await expect(identity.locator(".collections-slot-identity-name")).toContainText("Proof strike");
    await expect(identity.locator(".collections-slot-identity-year")).toHaveText("2024");
    await expect(row.locator(".collections-lrow-name .collections-linkbtn")).toHaveText(
      "2024 Canadian Silver Maple Leaf"
    );
    await expect(slotOf(page, blankSlotId).locator(".collections-note-toggle")).toHaveCount(0);
    const rowHeight = await row.evaluate((element) => element.getBoundingClientRect().height);

    await noteButton.click();
    const popover = page.getByRole("region", { name: "Note for Proof strike" });
    await expect(popover).toHaveText(LONG_SLOT_NOTE);
    await expect(noteButton).toHaveAttribute("aria-expanded", "true");
    expect(await row.evaluate((element) => element.getBoundingClientRect().height)).toBe(rowHeight);
    await page.screenshot({ path: testInfo.outputPath("strk-399-ledger-desktop.png") });
  });

  test("Slot note popover fits a 375px touch viewport without reserving blank-note space", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await installStakTrakrNetworkMocks(page);
    try {
      const { slotId, blankSlotId } = await createSlotNoteFixture(page);
      const card = slotOf(page, slotId);
      const noteButton = card.getByRole("button", { name: "Show note for Proof strike" });
      await expect(slotOf(page, blankSlotId).locator(".collections-note-toggle")).toHaveCount(0);
      await noteButton.evaluate((element) => element.scrollIntoView({ block: "center" }));
      const cardHeight = await card.evaluate((element) => element.getBoundingClientRect().height);
      const buttonBox = await noteButton.boundingBox();
      expect(buttonBox).not.toBeNull();
      expect(buttonBox.y).toBeGreaterThanOrEqual(0);
      expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(812);
      await page.touchscreen.tap(
        buttonBox.x + buttonBox.width / 2,
        buttonBox.y + buttonBox.height / 2
      );

      const popover = page.getByRole("region", { name: "Note for Proof strike" });
      await expect(popover).toBeVisible();
      await expect(popover).toHaveText(LONG_SLOT_NOTE);
      const popoverBox = await popover.boundingBox();
      expect(popoverBox).not.toBeNull();
      expect(popoverBox.x).toBeGreaterThanOrEqual(0);
      expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(375);
      expect(popoverBox.y).toBeGreaterThanOrEqual(0);
      expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(812);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        375
      );
      expect(await card.evaluate((element) => element.getBoundingClientRect().height)).toBe(
        cardHeight
      );
      await page.screenshot({
        path: testInfo.outputPath("strk-399-album-mobile-375.png"),
      });
    } finally {
      await context.close();
    }
  });

  test("cover upload and removal change the visible album and old image vaults cannot revive it", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    const id = await page.evaluate(() => {
      const created = window.collectionsStore.createCustom({
        name: "Artwork test set",
        slots: [{ label: "First" }],
      });
      window.collectionsUI.openCollection(created.collection.id);
      window.collectionsPicker.openBuilder({ editId: created.collection.id });
      return created.collection.id;
    });
    const builder = builderModal(page);
    await builder
      .locator(".collections-builder-cover input[type=file]")
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await builder.getByRole("button", { name: "Save changes" }).click();
    const cover = panel(page).locator(".collections-album-head .collections-coin img");
    await expect(cover).toHaveAttribute("src", /^blob:/);
    const staleVault = await page.evaluate(async () => {
      const images = await window.collectAndHashImageVault();
      return Array.from(await window.vaultEncryptImageVault("artwork-test", images.payload));
    });

    await page.evaluate(
      (collectionId) => window.collectionsPicker.openBuilder({ editId: collectionId }),
      id
    );
    await builder.getByRole("button", { name: "Remove cover image" }).click();
    await builder.getByRole("button", { name: "Save changes" }).click();
    await expect(cover).toHaveCount(0);
    expect(
      await page.evaluate(
        (collectionId) =>
          window.collectionsStore.getState().collections[collectionId].artwork.cover.present,
        id
      )
    ).toBe(false);

    await page.evaluate(
      (bytes) => window.vaultDecryptAndRestoreImages(new Uint8Array(bytes), "artwork-test"),
      staleVault
    );
    await page.evaluate(() => window.collectionsUI.render());
    await expect(cover).toHaveCount(0);
    await reloadApp(page);
    await expect(cover).toHaveCount(0);
  });

  test("the year-range shortcut accepts sane ranges only", async ({ page }) => {
    await seedAndGoto(page);
    const parsed = await page.evaluate(() => {
      const parse = window.collectionsPicker.parseYearRange;
      return [
        parse("1986-1990"),
        parse("1999"),
        parse("2005-1986"),
        parse("abc"),
        parse("1000-2999"),
      ];
    });
    expect(parsed).toEqual([[1986, 1987, 1988, 1989, 1990], [1999], null, null, null]);
  });

  test("the item view shows a Collections chip and section, and Unlink clears both", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openItemView(page, "col-ase-2024");

    const chip = viewModal(page).locator(".collections-view-chip");
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText("American Silver Eagle Type 2 · 2024");
    const section = viewModal(page).locator(".collections-view-section");
    await expect(section).toContainText("American Silver Eagle — Type 2");
    await expect(section).toContainText("2024 slot · primary · 1 of 6 collected");

    await section.getByRole("button", { name: "Unlink" }).click();
    await expect(viewModal(page).locator(".collections-view-chip")).toHaveCount(0);
    await expect(viewModal(page).locator(".collections-view-section")).toHaveCount(0);
    expect(await readSlot(page, "2024")).toEqual({ primary: null, spares: [] });
  });

  test("the item view chip opens the collection's album", async ({ page }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openItemView(page, "col-ase-2024");

    await viewModal(page).locator(".collections-view-chip").click();
    await expect(viewModal(page)).toBeHidden();
    await expect(page).toHaveURL(/#\/collections\/ase-type2$/);
    await expect(panel(page).getByRole("heading", { name: /American Silver Eagle/ })).toBeVisible();
  });

  test("an item in no collection shows neither chip nor section, even after viewing one that is", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openItemView(page, "col-ase-2024");
    await expect(viewModal(page).locator(".collections-view-chip")).toHaveCount(1);
    await page.evaluate(() => window.closeViewModal());

    // The badge row is shared DOM — a stale chip from the previous item must not survive.
    await openItemView(page, "col-maple-2024");
    await expect(viewModal(page).locator(".collections-view-chip")).toHaveCount(0);
    await expect(viewModal(page).locator(".collections-view-section")).toHaveCount(0);
  });

  test("hiding the Collections tab also hides item-modal links without unlinking the Item", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openItemView(page, "col-ase-2024");
    await expect(viewModal(page).locator(".collections-view-chip")).toHaveCount(1);

    await page.evaluate(() => window.showSettingsModal("site"));
    const tabToggle = page.locator(
      "#layoutTabConfigContainer tr[data-section-id='collections'] input"
    );
    // Item View remains above the Settings dialog and intercepts pointer events.
    // Dispatch the checkbox's real change handler to cover the Layout apply path.
    await tabToggle.evaluate((input) => {
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.locator("#tabBtnCollections")).toBeHidden();
    await expect(page.locator("#appBottomNav [data-tab='collections']")).toBeHidden();
    await expect(viewModal(page).locator(".collections-view-chip")).toHaveCount(0);
    await expect(viewModal(page).locator(".collections-view-section")).toHaveCount(0);
    await page.evaluate(() => window.hideSettingsModal());

    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });

    await page.evaluate(() => window.closeViewModal());
    await page.evaluate(() => window.showSettingsModal("site"));
    await tabToggle.check();
    await page.evaluate(() => window.hideSettingsModal());

    await openItemView(page, "col-ase-2024");
    await expect(viewModal(page).locator(".collections-view-chip")).toHaveCount(1);
    await expect(viewModal(page).locator(".collections-view-section")).toBeVisible();
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });
  });
});

test.describe("core/collections — ZIP backup round trip", () => {
  /**
   * Restore a ZIP with the diff modal stubbed to auto-accept.
   * @param {import('@playwright/test').Page} page - Browser page.
   * @param {number[]} zipBytes - Backup ZIP bytes.
   * @returns {Promise<void>} When the success toast is shown.
   */
  const restoreZip = async (page, zipBytes) => {
    await page.evaluate(async (bytes) => {
      window.__zipRestoreComplete = false;
      const origToast = window.showToast;
      window.showToast = (msg, level) => {
        if (typeof origToast === "function") origToast(msg, level);
        if (String(msg || "").includes("ZIP backup restored successfully")) {
          window.__zipRestoreComplete = true;
        }
      };
      window.showImportDiffReview = (_items, _meta, _opts, onDone) =>
        onDone({ added: 0, modified: 0, deleted: 0 });
      const file = new File([new Uint8Array(bytes)], "collections-restore.zip", {
        type: "application/zip",
      });
      await window.restoreBackupZip(file);
    }, zipBytes);
    await page.waitForFunction(() => window.__zipRestoreComplete === true);
  };

  test("Backup All Data carries collection_state.json, and a restore MERGES it into local state", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.waitForFunction(
      () => typeof window.createBackupZip === "function" && typeof window.JSZip !== "undefined"
    );

    // Phase 1 — a template link plus a custom collection, then export.
    const exported = await page.evaluate(async () => {
      const store = window.collectionsStore;
      store.link("ase-type2", "2024", "col-ase-2024");
      const made = store.createCustom({
        name: "Backup set",
        metal: "Silver",
        slots: [{ label: "Only" }],
      });
      store.link(made.collection.id, "only", "col-maple-2024");
      const blob = await window.createBackupZip();
      const buf = await blob.arrayBuffer();
      const zip = await window.JSZip.loadAsync(buf);
      const entry = zip.file("collection_state.json");
      return {
        customId: made.collection.id,
        payload: entry ? JSON.parse(await entry.async("string")) : null,
        zipBytes: Array.from(new Uint8Array(buf)),
      };
    });
    expect(exported.payload).not.toBeNull();
    expect(exported.payload.state.collections["ase-type2"].slots["2024"].primary).toBe(
      "col-ase-2024"
    );
    expect(exported.payload.state.collections[exported.customId].name).toBe("Backup set");

    // Phase 2 — lose the collections, then make a DIFFERENT local link before restoring.
    await page.evaluate(() => {
      localStorage.removeItem("collectionState");
      window.collectionsStore.load();
      window.collectionsStore.link("ase-type2", "2022", "col-ase-2022-a");
    });
    expect(await readSlot(page, "2024")).toBeNull();

    // Phase 3 — restore. The backup's links come back AND the newer local link survives:
    // a restore merges (collectionsCore.mergeStates), it never clobbers.
    await restoreZip(page, exported.zipBytes);
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });
    expect(await readSlot(page, "2022")).toEqual({ primary: "col-ase-2022-a", spares: [] });
    const custom = await page.evaluate((id) => {
      const collection = window.collectionsStore.getState().collections[id];
      return collection ? { name: collection.name, linked: collection.slots.only.primary } : null;
    }, exported.customId);
    expect(custom).toEqual({ name: "Backup set", linked: "col-maple-2024" });

    // Phase 4 — it is durable, not just in memory.
    await reloadCollections(page);
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });
  });

  test("a backup with no collections writes no collection_state.json, and restoring an old ZIP is harmless", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.waitForFunction(
      () => typeof window.createBackupZip === "function" && typeof window.JSZip !== "undefined"
    );
    const exported = await page.evaluate(async () => {
      const blob = await window.createBackupZip();
      const buf = await blob.arrayBuffer();
      const zip = await window.JSZip.loadAsync(buf);
      return {
        hasEntry: zip.file("collection_state.json") !== null,
        zipBytes: Array.from(new Uint8Array(buf)),
      };
    });
    expect(exported.hasEntry).toBe(false);

    // Links made after that (collection-less) backup must survive restoring it.
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2024", "col-ase-2024"));
    await restoreZip(page, exported.zipBytes);
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });
  });
});

test.describe("core/collections — tab UI", () => {
  // Owner decision 2026-09-18: the "Start your first collection" hero was removed — the ghosted
  // 0 / 6 card already IS the way in, so the banner only repeated it.
  test("a fresh profile shows the ASE Type 2 run at 0 / 6 with no first-run banner", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);

    await expect(
      panel(page).getByRole("heading", { name: "Start your first collection" })
    ).toHaveCount(0);
    await expect(panel(page).locator(".collections-stats")).toHaveCount(0);
    const entry = panel(page).locator(`[data-collection-id="${ASE}"]`);
    await expect(entry).toContainText("American Silver Eagle");
    await expect(entry).toContainText("0 / 6");
    // Only real Series Templates ship (ASE Type 2 and, since STRK-373, ASE Type 1) — the
    // mockup's Morgan demo entry must not.
    await expect(panel(page).locator('[data-collection-id="ase-type1"]')).toContainText("0 / 36");
    await expect(panel(page).locator("[data-collection-id]")).toHaveCount(2);
  });

  test("the hub lists Series Templates chronologically by run start, in both layouts", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);

    /** @returns {Promise<string[]>} Hub collection ids in rendered order. */
    const hubOrder = () =>
      panel(page)
        .locator("[data-collection-id]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-collection-id")));

    // index.json lists Type 2 first; the hub must not inherit that file order.
    expect(await hubOrder()).toEqual(["ase-type1", "ase-type2"]);
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    expect(await hubOrder()).toEqual(["ase-type1", "ase-type2"]);
  });

  test("linking an item moves the hub card to 1 / 6 and 17% without a reload", async ({ page }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);

    const entry = panel(page).locator(`[data-collection-id="${ASE}"]`);
    await expect(entry).toContainText("1 / 6");
    await expect(entry).toContainText("17%");
    await expect(
      panel(page).getByRole("heading", { name: "Start your first collection" })
    ).toHaveCount(0);
  });

  test("a manual Spot Price edit refreshes the open Collection's melt value", async ({ page }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openAseAlbum(page);

    const meltValue = panel(page)
      .locator(".collections-stat", { hasText: "Melt value" })
      .locator(".collections-stat-value");
    const before = await meltValue.textContent();

    // Drive the production shift+click editor seam while the Collection stays open,
    // then save through the editor's real Enter handler.
    await page.evaluate(() => {
      const value = document.getElementById("spotPriceDisplaySilver");
      window.startSpotInlineEdit(value, "silver");
      const input = value.querySelector(".spot-inline-input");
      input.value = "123.45";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    await expect(meltValue).not.toHaveText(before);
    await expect(meltValue).toHaveText("$123.33");
  });

  test("a filled slot shows the item's URL image and refreshes after its images change", async ({
    page,
  }) => {
    await page.route("https://images.test/*.png", (route) =>
      route.fulfill({ path: "tests/playwright/helpers/test-obverse.png", contentType: "image/png" })
    );
    await seedAndGoto(page);
    await page.evaluate(() => {
      const item = window.inventory.find((entry) => entry.uuid === "col-ase-2024");
      item.obverseImageUrl = "https://images.test/obverse.png";
      item.reverseImageUrl = "https://images.test/reverse.png";
      saveInventory();
    });
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openAseAlbum(page);
    const image = slotOf(page, "2024").locator(".collections-coin img");
    await expect(image).toHaveAttribute("src", "https://images.test/obverse.png");

    await page.evaluate(() =>
      window.editItem(window.inventory.findIndex((item) => item.uuid === "col-ase-2024"))
    );
    await expect(page.locator("#itemModal")).toBeVisible();
    await page.locator("#swapImagesBtn").click();
    await page.locator("#itemModalSubmit").click();
    await expect(page.locator("#itemModal")).toBeHidden();
    await expect(image).toHaveAttribute("src", "https://images.test/reverse.png");
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    await expect(slotOf(page, "2024").locator(".collections-coin img")).toHaveAttribute(
      "src",
      "https://images.test/reverse.png"
    );
  });

  test("a filled slot uses its linked item's uploaded obverse", async ({ page }) => {
    await seedAndGoto(page);
    const saved = await page.evaluate(async () => {
      const blob = await (await fetch("/tests/playwright/helpers/test-obverse.png")).blob();
      return window.imageCache.cacheUserImage("col-ase-2024", blob);
    });
    expect(saved).toBe(true);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openAseAlbum(page);
    await expect(slotOf(page, "2024").locator(".collections-coin img")).toHaveAttribute(
      "src",
      /^blob:/
    );
  });

  test("a hub card opens the in-page album; the breadcrumb and browser Back return", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await openAseAlbum(page);
    await expect(page).toHaveURL(/#\/collections\/ase-type2$/);

    const slots = panel(page).locator("[data-slot-id]");
    await expect(slots).toHaveCount(6);
    const slotIds = await slots.evaluateAll((els) => els.map((el) => el.dataset.slotId));
    expect(slotIds).toEqual(["2021-t2", "2022", "2023", "2024", "2025", "2026"]);
    for (const year of ["2021", "2022", "2023", "2024", "2025", "2026"]) {
      await expect(panel(page).getByText(year, { exact: true }).first()).toBeVisible();
    }
    await expect(slotOf(page, "2021-t2")).toContainText("T2");
    await expect(slotOf(page, "2021-t2")).toContainText("14,968,500 minted");
    await expect(slotOf(page, "2026")).toContainText("In production");

    await panel(page).getByRole("button", { name: "Collections", exact: true }).click();
    await expect(page).toHaveURL(/#\/collections$/);
    await expect(panel(page).locator(`[data-collection-id="${ASE}"]`)).toBeVisible();
    await expect(slots).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(/#\/collections\/ase-type2$/);
    await expect(slots).toHaveCount(6);

    await page.goBack();
    await expect(page).toHaveURL(/#\/collections$/);
    await expect(slots).toHaveCount(0);
  });

  test("a deep link lands on the album and survives a reload; an unknown id falls back to the hub", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.goto("/index.html#/collections/ase-type2");
    await expect(page.locator("#tabViewCollections")).toBeVisible();
    await expect(panel(page).locator("[data-slot-id]")).toHaveCount(6);

    await reloadApp(page);
    await expect(page.locator("#tabBtnCollections")).toHaveAttribute("aria-selected", "true");
    await expect(panel(page).locator("[data-slot-id]")).toHaveCount(6);
    await expect(page).toHaveURL(/#\/collections\/ase-type2$/);

    await page.goto("/index.html#/collections/no-such-collection");
    await expect(panel(page).locator(`[data-collection-id="${ASE}"]`)).toBeVisible();
    await expect(panel(page).locator("[data-slot-id]")).toHaveCount(0);
    await expect(page).toHaveURL(/#\/collections$/);
  });

  test("+ Add → Add new item fills the slot tile without a reload", async ({ page }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await openAseAlbum(page);
    await expect(panel(page).getByRole("button", { name: "Owned 0" })).toBeVisible();

    await slotOf(page, "2023").getByRole("button", { name: /Add/ }).click();
    await page.getByRole("menuitem", { name: /Add new item/ }).click();

    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemName")).toHaveValue("2023 American Silver Eagle");
    await expect(page.locator("#itemYear")).toHaveValue("2023");
    await page.fill("#itemPrice", "33.40");
    await page.click("#itemModalSubmit");
    await expect(page.locator("#itemModal")).toBeHidden();

    await expect(slotOf(page, "2023")).toContainText("2023 American Silver Eagle");
    await expect(panel(page).getByRole("button", { name: "Owned 1" })).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Missing 5" })).toBeVisible();
  });

  test("the view toggle switches both levels to the ledger and survives a reload", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openAseAlbum(page);
    await expect(panel(page).locator(".collections-slot")).toHaveCount(6);

    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    await expect(panel(page).locator(".collections-lrow[data-slot-id]")).toHaveCount(6);
    await expect(panel(page).locator(".collections-slot")).toHaveCount(0);
    await expect(slotOf(page, "2024")).toContainText("2024 American Silver Eagle BU");

    await reloadApp(page);
    await expect(panel(page).locator(".collections-lrow[data-slot-id]")).toHaveCount(6);
    await expect(panel(page).getByRole("button", { name: "Ledger view" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // ONE preference flips both levels: the hub is a table now, not cards.
    await panel(page).getByRole("button", { name: "Collections", exact: true }).click();
    await expect(
      panel(page).locator(`.collections-hubrow[data-collection-id="${ASE}"]`)
    ).toBeVisible();
    await expect(panel(page).locator(".collections-card")).toHaveCount(0);

    await panel(page).getByRole("button", { name: "Album view" }).click();
    await expect(
      panel(page).locator(`.collections-card[data-collection-id="${ASE}"]`)
    ).toBeVisible();
  });

  test("the Owned and Missing filters show the matching slots", async ({ page }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [
      ["2022", "col-ase-2022-a"],
      ["2024", "col-ase-2024"],
    ]);
    await openAseAlbum(page);
    const slots = panel(page).locator("[data-slot-id]");

    await panel(page).getByRole("button", { name: "Owned 2" }).click();
    await expect(slots).toHaveCount(2);
    await expect(slotOf(page, "2022")).toBeVisible();
    await expect(slotOf(page, "2024")).toBeVisible();

    await panel(page).getByRole("button", { name: "Missing 4" }).click();
    await expect(slots).toHaveCount(4);
    await expect(slotOf(page, "2022")).toHaveCount(0);

    await panel(page).getByRole("button", { name: "All", exact: true }).click();
    await expect(slots).toHaveCount(6);
  });

  test("clicking an owned tile opens the item view modal for the linked item", async ({ page }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openAseAlbum(page);

    await slotOf(page, "2024")
      .getByRole("button", { name: /2024 American Silver Eagle BU/ })
      .click();
    await expect(page.locator("#viewItemModal")).toBeVisible();
    await expect(page.locator("#viewModalTitle")).toHaveText("2024 American Silver Eagle BU");
  });

  test("the slot menu unlinks an item, and the picker seam degrades to a toast", async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openAseAlbum(page);

    // Resilience guard: if collections-picker.js ever fails to load, the seam must toast, never
    // throw. The picker ships now, so remove it on purpose to exercise the degraded path.
    await page.evaluate(() => {
      delete window.collectionsPicker;
    });
    await slotOf(page, "2023").getByRole("button", { name: /Add/ }).click();
    await page.getByRole("menuitem", { name: /Link existing item/ }).click();
    await expect(page.locator(".cloud-toast").first()).toHaveText("Coming in the next build");

    await slotOf(page, "2024")
      .getByRole("button", { name: /More actions/ })
      .click();
    await page.getByRole("menuitem", { name: /Unlink item/ }).click();
    await expect(slotOf(page, "2024")).not.toContainText("2024 American Silver Eagle BU");
    await expect(panel(page).getByRole("button", { name: "Owned 0" })).toBeVisible();
    // The Item itself is untouched — only the link is gone.
    expect(
      await page.evaluate(() => window.inventory.some((entry) => entry.uuid === "col-ase-2024"))
    ).toBe(true);
    expect(errors).toEqual([]);
  });

  test("at 390px the album is two columns and neither view overflows the page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAndGoto(page);
    await waitForApp(page);
    await page.locator("#appBottomNav [data-tab='collections']").click();
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openAseAlbum(page);

    /** @returns {Promise<number>} Horizontal page overflow in CSS pixels. */
    const overflow = () =>
      page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    const columns = await panel(page)
      .locator(".collections-slot")
      .evaluateAll(
        (els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().left))).size
      );
    expect(columns).toBe(2);
    expect(await overflow()).toBeLessThanOrEqual(0);

    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    await expect(panel(page).locator(".collections-lrow[data-slot-id]")).toHaveCount(6);
    await expect(slotOf(page, "2024")).toContainText("2024 American Silver Eagle BU");
    expect(await overflow()).toBeLessThanOrEqual(0);

    // The hub table collapses the same way.
    await panel(page).getByRole("button", { name: "Collections", exact: true }).click();
    await expect(
      panel(page).locator(`.collections-hubrow[data-collection-id="${ASE}"]`)
    ).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("the album renders in all four themes without page errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    await openAseAlbum(page);

    for (const theme of ["dark", "light", "slate", "sepia"]) {
      await page.evaluate((name) => window.setTheme(name), theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        panel(page).getByRole("heading", { name: /American Silver Eagle/ })
      ).toBeVisible();
      await expect(panel(page).locator("[data-slot-id]")).toHaveCount(6);
      await expect(slotOf(page, "2024")).toContainText("2024 American Silver Eagle BU");
      await expect(slotOf(page, "2023").getByRole("button", { name: /Add/ })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

const ledgerFixtures = JSON.parse(
  readFileSync(new URL("../../fixtures/collections-sort.json", import.meta.url), "utf8")
);

/** Arrange distinct raw values through the real store and render the hub.
 * @param {import('@playwright/test').Page} page - Browser page
 * @returns {Promise<void>}
 */
const seedSortableHub = async (page) => {
  const items = ledgerFixtures.flatMap((entry) =>
    Array.from({ length: entry.owned }, (_, index) => ({
      ...baseItem(`${entry.id}-${index}`, `${entry.name} Item ${index}`, "2024", index + 1),
      metal: entry.melt === null ? "Copper" : "Silver",
      weight: entry.melt === null ? 1 : entry.melt / entry.owned,
    }))
  );
  await seedAndGoto(page, items);
  await page.evaluate((fixtures) => {
    spotPrices.silver = 1;
    spotPrices.copper = 0;
    window.__COLLECTIONS_BUNDLE = {
      templates: Object.fromEntries(
        fixtures.map((entry, index) => [
          entry.id,
          {
            slug: entry.id,
            name: entry.name,
            metal: "Silver",
            run: { start: 2000 + index },
            retailSlug: entry.id,
            slots: Array.from({ length: entry.total }, (_, i) => ({
              id: String(i),
              label: `Slot ${i}`,
            })),
          },
        ])
      ),
    };
    window._v2RetailData = {
      prices: Object.fromEntries(
        fixtures.map((entry) => [
          entry.id,
          {
            vendors: entry.best === null ? {} : { apmex: { price: entry.best, in_stock: true } },
          },
        ])
      ),
    };
    for (const entry of fixtures) {
      for (let i = 0; i < entry.owned; i++) {
        const result = window.collectionsStore.link(entry.id, String(i), `${entry.id}-${i}`);
        if (!result.ok) throw new Error(JSON.stringify(result));
      }
    }
  }, ledgerFixtures);
  await openCollectionsTab(page);
  await panel(page).getByRole("button", { name: "Ledger view" }).click();
};

/** Visible hub names in rendered order.
 * @param {import('@playwright/test').Page} page - Browser page
 * @returns {import('@playwright/test').Locator} Collection name cells
 */
const ledgerNames = (page) =>
  panel(page).locator(".collections-hubrow[data-collection-id] .collections-lrow-name b");

const hubSortCases = [
  [
    "Collection",
    ["Alpha", "Beta", "Delta", "Unknown", "Zeta"],
    ["Zeta", "Unknown", "Delta", "Beta", "Alpha"],
  ],
  [
    "Progress",
    ["Delta", "Beta", "Unknown", "Zeta", "Alpha"],
    ["Zeta", "Alpha", "Unknown", "Beta", "Delta"],
  ],
  [
    "Owned",
    ["Delta", "Zeta", "Beta", "Unknown", "Alpha"],
    ["Alpha", "Zeta", "Beta", "Unknown", "Delta"],
  ],
  [
    "Value (melt)",
    ["Delta", "Zeta", "Beta", "Alpha", "Unknown"],
    ["Alpha", "Beta", "Zeta", "Delta", "Unknown"],
  ],
  [
    "To complete",
    ["Zeta", "Beta", "Alpha", "Delta", "Unknown"],
    ["Alpha", "Beta", "Zeta", "Delta", "Unknown"],
  ],
];

test.describe("hub Ledger sorting", () => {
  for (const [label, ascending, descending] of hubSortCases) {
    test(`${label} sorts visible rows in both directions`, async ({ page }) => {
      await seedSortableHub(page);
      const header = panel(page).getByRole("button", {
        name: `Sort by ${label}, not sorted`,
        exact: true,
      });
      await header.click();
      await expect(ledgerNames(page)).toHaveText(ascending);
      await panel(page)
        .getByRole("button", { name: `Sort by ${label}, ascending`, exact: true })
        .click();
      await expect(ledgerNames(page)).toHaveText(descending);
      await expect(page).toHaveURL(/#\/collections$/);
    });
  }

  test("keyboard sorting survives filters and Album round trips without saved-order changes", async ({
    page,
  }) => {
    await seedSortableHub(page);
    const saved = await page.evaluate(() => JSON.stringify(window.collectionsStore.getState()));
    const header = panel(page).getByRole("button", {
      name: "Sort by Owned, not sorted",
      exact: true,
    });
    await header.focus();
    await header.press("Enter");
    const active = panel(page).getByRole("button", {
      name: "Sort by Owned, ascending",
      exact: true,
    });
    await expect(active).toBeFocused();
    await active.press("Space");
    await expect(ledgerNames(page)).toHaveText(hubSortCases[2][2]);
    await panel(page).getByRole("button", { name: "In progress", exact: true }).click();
    await expect(ledgerNames(page)).toHaveText(["Alpha", "Zeta", "Beta", "Unknown"]);
    await panel(page).getByRole("button", { name: "Complete", exact: true }).click();
    await expect(panel(page)).toContainText("No collections match this filter");
    await panel(page).getByRole("button", { name: "All", exact: true }).click();
    await expect(ledgerNames(page)).toHaveText(hubSortCases[2][2]);
    await panel(page).getByRole("button", { name: "Album view" }).click();
    await expect(panel(page).locator(".collections-card-name b")).toHaveText(
      ledgerFixtures.map((entry) => entry.name)
    );
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    await expect(ledgerNames(page)).toHaveText(hubSortCases[2][2]);
    expect(await page.evaluate(() => JSON.stringify(window.collectionsStore.getState()))).toBe(
      saved
    );
  });

  test("mobile Sort exposes every column and both directions with default-order reset", async ({
    page,
  }) => {
    await seedSortableHub(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel(page).locator(".is-head")).toBeHidden();
    const select = panel(page).getByRole("combobox", { name: "Sort collections" });
    await expect(select).toBeVisible();
    for (let i = 0; i < hubSortCases.length; i++) {
      const key = ["name", "progress", "owned", "melt", "cost"][i];
      await select.selectOption(`${key}:asc`);
      await expect(ledgerNames(page)).toHaveText(hubSortCases[i][1]);
      await select.selectOption(`${key}:desc`);
      await expect(ledgerNames(page)).toHaveText(hubSortCases[i][2]);
    }
    await select.selectOption("");
    await expect(ledgerNames(page)).toHaveText(ledgerFixtures.map((entry) => entry.name));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
});

test("hub Ledger sorting remains usable in four themes", async ({ page }, testInfo) => {
  await seedSortableHub(page);
  await panel(page)
    .getByRole("button", { name: "Sort by Progress, not sorted", exact: true })
    .click();
  for (const theme of ["dark", "light", "slate", "sepia"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme
    );
    await expect(ledgerNames(page)).toHaveText(hubSortCases[1][1]);
    await expect(
      panel(page).getByRole("button", { name: "Sort by Progress, ascending", exact: true })
    ).toBeVisible();
    await panel(page).screenshot({ path: testInfo.outputPath(`hub-${theme}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page).getByRole("combobox", { name: "Sort collections" })).toBeVisible();
  await panel(page).screenshot({ path: testInfo.outputPath("hub-mobile.png") });
});

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

    await expect(builderModal(page).locator(".collections-builder-move")).toHaveCount(6);
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

  test("STRK-389 inserts and moves Slots with stable links and saved Album/Ledger order", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    const id = await page.evaluate(() => {
      const store = window.collectionsStore;
      const made = store.createCustom({
        name: "Black Flag",
        slots: [
          { label: "2019", year: "2019" },
          { label: "2020", year: "2020", note: "Original" },
          { label: "2021", year: "2021" },
        ],
      });
      store.link(made.collection.id, "2020", "col-ase-2022-a");
      store.link(made.collection.id, "2020", "col-ase-2022-b", { asSpare: true });
      window.collectionsUI.openCollection(made.collection.id);
      window.collectionsPicker.openBuilder({ editId: made.collection.id });
      return made.collection.id;
    });
    const builder = builderModal(page);
    await builder
      .locator(".collections-builder-row")
      .nth(1)
      .locator("input[type=file]")
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await builder.getByRole("button", { name: "Add Slot after 2020", exact: true }).click();
    await expect(builder.getByLabel("Slot label").nth(2)).toBeFocused();
    await builder.getByLabel("Slot label").nth(2).fill("2020 Antiqued");
    await builder
      .getByRole("button", { name: "Move 2020 Antiqued up", exact: true })
      .press("Enter");
    await expect(
      builder.getByRole("button", { name: "Move 2020 Antiqued up", exact: true })
    ).toBeFocused();
    await builder.getByLabel("Slot label").nth(1).fill("2020");
    await builder.getByRole("button", { name: "Save changes" }).click();
    await expect(builder).toBeHidden();
    const saved = await page.evaluate(
      (id) => window.collectionsStore.getState().collections[id],
      id
    );
    expect(saved.definition.slots.map((slot) => slot.id)).toEqual([
      "2019",
      "2020-2",
      "2020",
      "2021",
    ]);
    expect(saved.definition.slots[2].note).toBe("Original");
    expect(saved.slots["2020"].primary).toBe("col-ase-2022-a");
    expect(saved.slots["2020"].spares).toEqual(["col-ase-2022-b"]);
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const record = await window.imageCache.getPatternImage(`collection--${id}--2020`);
          return !!record;
        }, id)
      )
      .toBe(true);
    expect(
      await page.evaluate(
        async (id) => !!(await window.imageCache.getPatternImage(`collection--${id}--2020-2`)),
        id
      )
    ).toBe(false);
    const displayed = () =>
      panel(page)
        .locator("[data-slot-id]")
        .evaluateAll((rows) => rows.map((row) => row.dataset.slotId));
    await expect.poll(displayed).toEqual(["2019", "2020-2", "2020", "2021"]);
    await panel(page).getByRole("button", { name: "Reverse", exact: true }).click();
    await expect.poll(displayed).toEqual(["2021", "2020", "2020-2", "2019"]);
    await panel(page).getByRole("button", { name: "Collection order", exact: true }).click();
    await panel(page)
      .getByRole("button", { name: /Ledger/ })
      .click();
    await expect.poll(displayed).toEqual(["2019", "2020-2", "2020", "2021"]);
    await reloadCollections(page);
    await page.evaluate((id) => window.collectionsUI.openCollection(id), id);
    await expect.poll(displayed).toEqual(["2019", "2020-2", "2020", "2021"]);
    await panel(page).getByRole("button", { name: "Edit collection", exact: true }).click();
    await expect(builder.getByLabel("Slot label").nth(2)).toHaveValue("2020");
  });

  test("STRK-389 arrow boundaries, mobile themes, Cancel and close preserve saved Slots", async ({
    page,
  }, testInfo) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await page.setViewportSize({ width: 375, height: 812 });
    const id = await page.evaluate(() => {
      const made = window.collectionsStore.createCustom({
        name: "Black Flag",
        slots: [{ label: "2019" }, { label: "2020" }],
      });
      window.collectionsPicker.openBuilder({ editId: made.collection.id });
      return made.collection.id;
    });
    const builder = builderModal(page);
    for (const theme of ["dark", "light", "slate", "sepia"]) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await expect(
        builder.getByRole("button", { name: "Move 2019 up", exact: true })
      ).toBeDisabled();
      await expect(
        builder.getByRole("button", { name: "Move 2020 down", exact: true })
      ).toBeDisabled();
      const arrows = builder.locator(".collections-builder-move");
      await arrows.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`editor-${theme}.png`) });
      for (const arrow of await arrows.all()) {
        const box = await arrow.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width).toBeLessThanOrEqual(375);
      }
    }
    await builder.getByRole("button", { name: "Move 2020 up", exact: true }).press("Space");
    await expect(builder.getByLabel("Slot label").first()).toHaveValue("2020");
    await expect(builder.getByLabel("Slot label").first()).toBeFocused();
    await builder.getByRole("button", { name: "Add Slot after 2020", exact: true }).click();
    await builder.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate((id) => window.collectionsPicker.openBuilder({ editId: id }), id);
    await expect(builder.getByLabel("Slot label")).toHaveCount(2);
    await expect(builder.getByLabel("Slot label").first()).toHaveValue("2019");
    await builder.getByRole("button", { name: "Move 2020 up", exact: true }).click();
    await builder.getByRole("button", { name: /Close/ }).click();
    await page.evaluate((id) => window.collectionsPicker.openBuilder({ editId: id }), id);
    await expect(builder.getByLabel("Slot label").first()).toHaveValue("2019");
  });

  test("the Custom Collection builder media row stacks at a 375px viewport", async ({ page }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await panel(page)
      .getByRole("button", { name: /New collection/ })
      .first()
      .click();

    const media = builderModal(page).locator(".collections-builder-media");
    const cover = media.locator(".collections-builder-cover");
    const display = media.locator(".collections-builder-display");
    await expect(media).toBeVisible();
    await expect(cover).toBeVisible();
    await expect(display).toBeVisible();

    const coverBox = await cover.boundingBox();
    const displayBox = await display.boundingBox();
    expect(coverBox).not.toBeNull();
    expect(displayBox).not.toBeNull();
    expect(displayBox.x).toBeCloseTo(coverBox.x, 0);
    expect(displayBox.width).toBeCloseTo(coverBox.width, 0);
    expect(displayBox.y).toBeGreaterThan(coverBox.y);
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
    await builderModal(page).getByRole("button", { name: "Move 2022 up", exact: true }).click();
    await expect(builderModal(page).getByLabel("Slot label").first()).toHaveValue("2022");

    await builderModal(page).getByRole("button", { name: "Create collection" }).click();
    await expect(builderModal(page)).toBeHidden();
    const clone = await page.evaluate(() => {
      const list = window.collectionsCore.listCollections(window.collectionsStore.getState());
      const custom = list.find((entry) => entry.kind === "custom");
      return custom
        ? {
            clonedFrom: custom.clonedFrom,
            slots: custom.definition.slots.length,
            variant: custom.definition.variant,
            itemType: custom.definition.itemType,
            purity: custom.definition.purity,
            imageShape: custom.definition.imageShape,
          }
        : null;
    });
    expect(clone).toEqual({
      clonedFrom: "ase-type2",
      slots: 6,
      variant: "Type 2",
      itemType: "Coin",
      purity: 0.999,
      imageShape: "round",
    });
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

  test("Custom Collection metadata drives shape defaults, Item prefill, and visible details", async ({
    page,
  }, testInfo) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await panel(page)
      .getByRole("button", { name: /New collection/ })
      .first()
      .click();
    const builder = builderModal(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ["light", "dark", "slate", "sepia"]) {
      await page.evaluate((value) => window.setTheme(value), theme);
      await expect(builder.getByRole("heading", { name: "Identity" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390
      );
    }
    await builder.screenshot({
      path: testInfo.outputPath("strk-395-builder-390.png"),
      animations: "disabled",
    });
    await builder.getByLabel("Collection name").fill("Graded Eagles");
    await builder.getByLabel("Variant").fill("MS-70");
    await builder.getByLabel("Subtitle").fill("Early releases");
    await builder.getByLabel("Issuer").fill("United States Mint");
    await builder.getByLabel("Metal").selectOption("Gold");
    await builder.getByLabel("Type").selectOption("Bar");
    await expect(builder.getByLabel("Image shape")).toHaveValue("bar");
    await builder.getByLabel("Type").selectOption("Coin");
    await expect(builder.getByLabel("Image shape")).toHaveValue("round");
    await builder.getByLabel("Image shape").selectOption("slab");
    await builder.getByLabel("Weight", { exact: true }).fill("1");
    await builder.getByLabel("Purity", { exact: true }).selectOption("0.9167");
    await builder.getByLabel("Diameter").fill("40.6");
    await builder.getByLabel("Face value").fill("$1");
    await builder.getByLabel("Dimensions").fill("40.6 mm diameter");
    await builder.getByLabel("About this collection").fill("A graded run.");
    await builder.getByLabel("Slot label").first().fill("2024 Eagle");
    await builder.getByRole("button", { name: "Create collection" }).click();

    const album = panel(page);
    await expect(album.locator(".collections-album-head .collections-tag.is-variant")).toHaveText(
      "MS-70"
    );
    await expect(album.locator(".collections-sub")).toContainText("Early releases");
    await expect(album.locator(".collections-sub")).toContainText("United States Mint");
    await expect(album.locator(".collections-spec")).toContainText(".9167 fine gold");
    await expect(album.locator(".collections-spec")).toContainText("40.6 mm diameter");
    await expect(album.locator(".collections-about")).toHaveText("A graded run.");
    await expect(
      album.locator(".collections-album-head .collections-coin--shape-slab")
    ).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.setTheme("light"));
    await panel(page).screenshot({
      path: testInfo.outputPath("strk-395-album-metadata.png"),
      animations: "disabled",
    });

    const customId = await page.evaluate(
      () =>
        window.collectionsCore
          .listCollections(window.collectionsStore.getState())
          .find((entry) => entry.kind === "custom").id
    );
    await page.evaluate((id) => window.collectionsPicker.openBuilder({ editId: id }), customId);
    await expect(builder.getByLabel("Variant")).toHaveValue("MS-70");
    await expect(builder.getByLabel("Type")).toHaveValue("Coin");
    await expect(builder.getByLabel("Image shape")).toHaveValue("slab");
    await expect(builder.getByLabel("About this collection")).toHaveValue("A graded run.");
    await expect(builder.getByLabel("Dimensions")).toHaveValue("40.6 mm diameter");
    await builder.getByRole("button", { name: "Cancel" }).click();
    await page.evaluate((id) => window.collectionsStore.requestNewItem(id, "2024-eagle"), customId);
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemType")).toHaveValue("Coin");
    await expect(page.locator("#itemMetal")).toHaveValue("Gold");
    await expect(page.locator("#itemWeight")).toHaveValue("1");
    await expect(page.locator("#itemPuritySelect")).toHaveValue("0.9167");

    await page.locator("#cancelItem").click();
    await panel(page).getByRole("button", { name: "Collections" }).click();
    const card = panel(page).locator(".collections-card").filter({ hasText: "Graded Eagles" });
    await expect(card.locator(".collections-card-name .collections-tag")).toHaveCount(0);
    await expect(card.locator(".collections-card-name")).toContainText("Graded Eagles");
    await expect(card.locator(".collections-card-sub")).toContainText("MS-70");
    await expect(card.locator(".collections-card-sub")).toContainText("Gold");
    await expect(card.locator(".collections-card-sub")).toContainText("1 oz");
    await expect(card.locator(".collections-card-sub")).toContainText(".9167 fine gold");
  });

  test("a Constitutional Custom Collection prefills its defined face value", async ({ page }) => {
    await seedAndGoto(page);
    const id = await page.evaluate(() => {
      const created = window.collectionsStore.createCustom({
        name: "Junk silver",
        metal: "Silver",
        itemType: "Constitutional",
        weight: 5,
        weightUnit: "cu",
        slots: [{ label: "Roll" }],
      });
      return created.collection.id;
    });
    await page.evaluate(
      (collectionId) => window.collectionsStore.requestNewItem(collectionId, "roll"),
      id
    );
    await expect(page.locator("#itemModal")).toBeVisible();
    await expect(page.locator("#itemWeightUnit")).toHaveValue("cu");
    await expect(page.locator("#item-constitutional-face")).toHaveValue("5");
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
    await builder.getByRole("radiogroup", { name: "Coin side" }).getByLabel("Reverse").check();
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

  /**
   * Seeds the Maple Item with its own obverse photo (routed to a local fixture) and opens
   * a Custom Collection whose "maple" Slot links it; extra Slots stay empty.
   * @param {import("@playwright/test").Page} page - Test page
   * @param {string[]} [extraSlots] - Labels of additional, unlinked Slots
   * @returns {Promise<string>} The Custom Collection id
   */
  const openMaplePhotoCollection = async (page, extraSlots = []) => {
    await page.route("https://images.test/*.png", (route) =>
      route.fulfill({ path: "tests/playwright/helpers/test-obverse.png", contentType: "image/png" })
    );
    await seedAndGoto(
      page,
      SEED.map((item) =>
        item.uuid === "col-maple-2024"
          ? {
              ...item,
              obverseImageUrl: "https://images.test/maple.png",
              reverseImageUrl: "",
              ignorePatternImages: true,
            }
          : item
      )
    );
    return page.evaluate((labels) => {
      const created = window.collectionsStore.createCustom({
        name: "Artwork only",
        slots: [{ label: "Maple" }, ...labels.map((label) => ({ label }))],
      });
      window.collectionsStore.link(created.collection.id, "maple", "col-maple-2024");
      window.collectionsUI.openCollection(created.collection.id);
      return created.collection.id;
    }, extraSlots);
  };

  test("the Item images choice hides linked Item photos in Slots and persists", async ({
    page,
  }) => {
    const id = await openMaplePhotoCollection(page);
    const coin = () => slotOf(page, "maple").locator(".collections-coin");
    await expect(coin().locator("img")).toHaveAttribute("src", /images\.test\/maple\.png$/);

    await page.evaluate((collectionId) => {
      window.collectionsPicker.openBuilder({ editId: collectionId });
    }, id);
    const builder = builderModal(page);
    const itemImages = builder.getByRole("radiogroup", { name: "Item images" });
    await expect(itemImages.getByLabel("Show")).toBeChecked();
    await itemImages.getByLabel("Hide").check();
    await builder.getByRole("button", { name: "Save changes" }).click();

    // Hidden: the medallion is never marked for the async Item photo pass, so it cannot
    // resolve the photo; the Slot still reads as filled (owned, not ghosted).
    await expect(slotOf(page, "maple")).toHaveClass(/is-owned/);
    await expect(coin()).not.toHaveAttribute("data-item-uuid", /./);
    await expect(coin().locator("img")).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    await expect(coin()).not.toHaveAttribute("data-item-uuid", /./);
    await expect(coin().locator("img")).toHaveCount(0);

    await reloadApp(page);
    expect(
      await page.evaluate(
        (collectionId) =>
          window.collectionsStore.getState().collections[collectionId].definition.showItemImages,
        id
      )
    ).toBe(false);
    await expect(coin()).not.toHaveAttribute("data-item-uuid", /./);

    await page.evaluate((collectionId) => {
      window.collectionsPicker.openBuilder({ editId: collectionId });
    }, id);
    await expect(itemImages.getByLabel("Hide")).toBeChecked();
    await itemImages.getByLabel("Show").check();
    await builder.getByRole("button", { name: "Save changes" }).click();
    await expect(coin().locator("img")).toHaveAttribute("src", /images\.test\/maple\.png$/);
  });

  test("hidden Item images use Slot art first and title art for empty Slots", async ({ page }) => {
    const id = await openMaplePhotoCollection(page, ["Open"]);
    await page.evaluate((collectionId) => {
      window.collectionsPicker.openBuilder({ editId: collectionId });
    }, id);
    const builder = builderModal(page);
    await builder
      .locator(".collections-builder-title-option input[type=file]")
      .first()
      .setInputFiles("tests/playwright/helpers/test-reverse.png");
    await builder.getByRole("radiogroup", { name: "Item images" }).getByLabel("Hide").check();
    await builder.getByRole("button", { name: "Save changes" }).click();

    // The filled Slot shows the cover (a blob: URL from the image store), never the Item photo.
    const filled = slotOf(page, "maple").locator(".collections-coin");
    await expect(filled).not.toHaveAttribute("data-item-uuid", /./);
    await expect(filled.locator("img")).toHaveAttribute("src", /^blob:/);
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    await expect(filled.locator("img")).toHaveAttribute("src", /^blob:/);

    // Empty Slots show the ghosted title image after their own Slot artwork.
    const emptyCoin = slotOf(page, "open").locator(".collections-coin");
    await expect(emptyCoin).toHaveClass(/collections-coin--ghost/);
    await expect(emptyCoin.locator("img")).toHaveAttribute("src", /^blob:/);
  });

  test("image fallbacks keep displayed side metadata aligned with the actual art", async ({
    page,
  }) => {
    await page.route("https://images.test/*.png", (route) => {
      if (route.request().url().endsWith("/missing.png")) {
        return route.fulfill({ status: 404 });
      }
      return route.fulfill({
        path: "tests/playwright/helpers/test-obverse.png",
        contentType: "image/png",
      });
    });
    await page.addInitScript(() => {
      window.__collectionsMissingImageFailed = false;
      document.addEventListener(
        "error",
        (event) => {
          if (event.target instanceof HTMLImageElement && event.target.src.endsWith("/missing.png"))
            window.__collectionsMissingImageFailed = true;
        },
        true
      );
    });
    const imageFallbackSeed = SEED.map((item) => {
      if (item.uuid === "col-ase-2024")
        return {
          ...item,
          obverseImageUrl: "https://images.test/missing.png",
          reverseImageUrl: "",
          ignorePatternImages: true,
        };
      if (item.uuid === "col-maple-2024")
        return {
          ...item,
          obverseImageUrl: "https://images.test/obverse.png",
          reverseImageUrl: "",
          ignorePatternImages: true,
        };
      return item;
    });
    await seedAndGoto(page, imageFallbackSeed);
    await openCollectionsTab(page);
    await page.evaluate(() => {
      const item = window.inventory.find((entry) => entry.uuid === "col-ase-2024");
      window.collectionsStore.link("ase-type2", "2024", item.uuid);
      window.collectionsUI.openCollection("ase-type2");
    });

    await expect.poll(() => page.evaluate(() => window.__collectionsMissingImageFailed)).toBe(true);
    const stockCoin = slotOf(page, "2024").locator(".collections-coin");
    const stockImage = stockCoin.locator("img");
    await expect(stockImage).toHaveAttribute("src", /data\/collections\/ase-type2\/obverse\.png$/);
    await expect(stockImage).toHaveAttribute("alt", "obverse of 2024");
    await expect(stockCoin).toHaveAttribute("data-image-side", "obverse");
    await expect(stockCoin).toHaveAttribute("data-resolved-image-side", "obverse");

    await page.evaluate(() => {
      const item = window.inventory.find((entry) => entry.uuid === "col-maple-2024");
      const created = window.collectionsStore.createCustom({
        name: "Reverse image fallback",
        side: "reverse",
        slots: [{ label: "Maple" }],
      });
      window.collectionsStore.link(created.collection.id, "maple", item.uuid);
      window.collectionsUI.openCollection(created.collection.id);
    });

    const coin = slotOf(page, "maple").locator(".collections-coin");
    const image = coin.locator("img");
    await expect(image).toHaveAttribute("src", /images\.test\/obverse\.png$/);
    await expect(image).toHaveAttribute("alt", "obverse of Maple");
    await expect(coin).toHaveAttribute("data-image-side", "reverse");
    await expect(coin).toHaveAttribute("data-resolved-image-side", "obverse");
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
    await expect(popover).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(popover).toBeHidden();
    await expect(noteButton).toHaveAttribute("aria-expanded", "false");

    await noteButton.click();
    await expect(popover).toBeVisible();
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
    await page.addInitScript(() => {
      const createObjectUrl = URL.createObjectURL.bind(URL);
      const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
      window.__collectionUrls = { created: [], revoked: [], doubleRevokes: [] };
      URL.createObjectURL = (blob) => {
        const url = createObjectUrl(blob);
        window.__collectionUrls.created.push(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        if (window.__collectionUrls.revoked.includes(url))
          window.__collectionUrls.doubleRevokes.push(url);
        window.__collectionUrls.revoked.push(url);
        revokeObjectUrl(url);
      };
    });
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
      .locator(".collections-builder-title-option input[type=file]")
      .first()
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await builder
      .locator(".collections-builder-title-option")
      .filter({ hasText: "Reverse title image" })
      .locator("input[type=file]")
      .setInputFiles("tests/playwright/helpers/test-reverse.png");
    await builder.getByRole("button", { name: "Save changes" }).click();
    const chooserUrlAudit = await page.evaluate(() => {
      const urls = Array.from(document.querySelectorAll("#collectionsBuilderModal img"))
        .map((image) => image.src)
        .filter((url) => url.startsWith("blob:"));
      return {
        urls,
        revoked: window.__collectionUrls.revoked,
        doubleRevokes: window.__collectionUrls.doubleRevokes,
      };
    });
    expect(chooserUrlAudit.urls.length).toBeGreaterThanOrEqual(2);
    expect(chooserUrlAudit.urls.every((url) => chooserUrlAudit.revoked.includes(url))).toBe(true);
    expect(chooserUrlAudit.doubleRevokes).toEqual([]);
    const titleImages = panel(page).locator(".collections-album-head .collections-coin img");
    await expect(titleImages).toHaveCount(2);
    await expect(titleImages.nth(0)).toHaveAttribute("src", /^blob:/);
    await expect(slotOf(page, "first").locator(".collections-coin img")).toHaveAttribute(
      "src",
      /^blob:/
    );
    await expect(slotOf(page, "first").locator(".collections-coin")).toHaveAttribute(
      "data-resolved-image-side",
      "obverse"
    );
    await reloadApp(page);
    await expect(slotOf(page, "first").locator(".collections-coin img")).toHaveAttribute(
      "src",
      /^blob:/
    );

    await page.evaluate(
      (collectionId) => window.collectionsPicker.openBuilder({ editId: collectionId }),
      id
    );
    await builder.getByRole("radiogroup", { name: "Coin side" }).getByLabel("Reverse").check();
    await builder.getByRole("button", { name: "Save changes" }).click();
    await expect(slotOf(page, "first").locator(".collections-coin")).toHaveAttribute(
      "data-resolved-image-side",
      "reverse"
    );
    await page.evaluate(
      (collectionId) => window.collectionsPicker.openBuilder({ editId: collectionId }),
      id
    );
    await builder.getByRole("button", { name: "Remove cover image" }).click();
    await builder.getByRole("button", { name: "Save changes" }).click();
    await expect(panel(page).locator(".collections-album-head .collections-coin img")).toHaveCount(
      1
    );
    await expect(slotOf(page, "first").locator(".collections-coin")).toHaveAttribute(
      "data-resolved-image-side",
      "reverse"
    );
    await page.evaluate(
      (collectionId) => window.collectionsPicker.openBuilder({ editId: collectionId }),
      id
    );
    await builder.getByRole("radiogroup", { name: "Coin side" }).getByLabel("Obverse").check();
    await builder.getByRole("button", { name: "Save changes" }).click();
    await expect(slotOf(page, "first").locator(".collections-coin")).toHaveAttribute(
      "data-resolved-image-side",
      "reverse"
    );
    const staleVault = await page.evaluate(async () => {
      const images = await window.collectAndHashImageVault();
      return Array.from(await window.vaultEncryptImageVault("artwork-test", images.payload));
    });

    await page.evaluate(
      (collectionId) => window.collectionsPicker.openBuilder({ editId: collectionId }),
      id
    );
    await builder.getByRole("button", { name: "Remove reverse title image" }).click();
    await builder.getByRole("button", { name: "Save changes" }).click();
    await expect(slotOf(page, "first").locator(".collections-coin img")).toHaveCount(0);
    expect(
      await page.evaluate(
        (collectionId) =>
          window.imageCache.getPatternImage(`collection--${collectionId}--@title-reverse`),
        id
      )
    ).toBeNull();

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
    await expect(slotOf(page, "first").locator(".collections-coin img")).toHaveCount(0);
    await reloadApp(page);
    await expect(slotOf(page, "first").locator(".collections-coin img")).toHaveCount(0);
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
        slots: [{ label: "Only", mintage: 25000 }],
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
      return collection
        ? {
            name: collection.name,
            linked: collection.slots.only.primary,
            mintage: collection.definition.slots[0].mintage,
          }
        : null;
    }, exported.customId);
    expect(custom).toEqual({ name: "Backup set", linked: "col-maple-2024", mintage: 25000 });

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
    await expect(slotOf(page, "2021-t2").locator(".collections-slot-label")).toHaveText("2021");
    await expect(slotOf(page, "2021-t2").locator(".collections-slot-identity-year")).toHaveCount(0);
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

/** Locate the rendered Collections panel inside the Settings modal. */
const settingsCollectionsPanel = (page) => page.locator("#settingsPanel_collections");

/**
 * Locate one Collection's accessible On/Off control group by its visible name.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {string} label - Collection name shown in the Settings row.
 * @returns {import('@playwright/test').Locator} The visibility control group.
 */
const settingsVisibilityGroup = (page, label) =>
  settingsCollectionsPanel(page).getByRole("group", { name: `Show ${label} in Collections` });

/**
 * Open Settings › Collections through the nav item or the direct Settings API.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {"direct"|"nav"} [via="direct"] - Route used to open the panel.
 * @returns {Promise<import('@playwright/test').Locator>} The visible Collections panel.
 */
const openSettingsCollections = async (page, via = "direct") => {
  await page.waitForFunction(
    () => window.appListenersReady === true && typeof window.showSettingsModal === "function"
  );
  if (via === "nav") {
    await page.locator("#settingsBtn").click();
    await expect(page.locator("#settingsModal")).toBeVisible();
    const collectionsNav = page.locator('.settings-nav-item[data-section="collections"]');
    await expect(collectionsNav).toBeVisible({ timeout: 2000 });
    await collectionsNav.click({ timeout: 2000 });
  } else {
    await page.evaluate(() => window.showSettingsModal("collections"));
  }
  await expect(settingsCollectionsPanel(page)).toBeVisible({ timeout: 2000 });
  return settingsCollectionsPanel(page);
};

/** Close the Settings modal and wait for it to leave the visible page. */
const closeSettingsCollections = async (page) => {
  await page.evaluate(() => window.hideSettingsModal());
  await expect(page.locator("#settingsModal")).toBeHidden();
};

test.describe("core/collections — STRK-393 Collections Settings", () => {
  test("Settings lists every template and live Custom Collection, with progress and the tab after Images", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const fixture = await page.evaluate(() => {
      const live = window.collectionsStore.createCustom({
        name: "Live Morgan Set",
        metal: "Silver",
        slots: [{ label: "First" }, { label: "Second" }],
      });
      const removed = window.collectionsStore.createCustom({
        name: "Removed Morgan Set",
        metal: "Silver",
        slots: [{ label: "Removed" }],
      });
      window.collectionsStore.remove(removed.collection.id);
      return {
        templateCount: Object.keys(window.__COLLECTIONS_BUNDLE.templates).length,
      };
    });

    const settings = await openSettingsCollections(page, "nav");
    const imagesNav = page.locator('.settings-nav-item[data-section="images"]');
    const collectionsNav = page.locator('.settings-nav-item[data-section="collections"]');
    expect(
      await imagesNav.evaluate(
        (images, collections) =>
          Boolean(images.compareDocumentPosition(collections) & Node.DOCUMENT_POSITION_FOLLOWING),
        await collectionsNav.elementHandle()
      )
    ).toBe(true);

    // STRK-378 merged the Series Templates and Custom Collections tables into one My order
    // list; every template plus each live Custom Collection is one row with a Type badge.
    const rows = settings.locator(".collections-settings-row[data-collection-id]");
    await expect(rows).toHaveCount(fixture.templateCount + 1);
    await expect(settings.getByText("Template", { exact: true })).toHaveCount(
      fixture.templateCount
    );
    const liveRow = rows.filter({ hasText: "Live Morgan Set" });
    await expect(liveRow).toHaveCount(1);
    await expect(liveRow.getByText("Custom", { exact: true })).toBeVisible();
    await expect(liveRow).toContainText("2 Slots");
    await expect(liveRow).toContainText("0 / 2");
    await expect(settings).not.toContainText("Removed Morgan Set");
    await expect(settingsVisibilityGroup(page, "American Silver Eagle Type 1")).toBeVisible();
    await expect(
      settings.locator(
        '.collections-settings-row[data-collection-id="ase-type1"] .collections-settings-meta'
      )
    ).toContainText("not started");
    await expect(settingsVisibilityGroup(page, "American Silver Eagle Type 2")).toBeVisible();
    await expect(settingsRow(page, "ase-type1")).toContainText("0 / 36");
    await expect(settingsRow(page, "ase-type2")).toContainText("0 / 6");
    await expect(settingsRow(page, "ase-type1")).toContainText(
      /Type 1.*Heraldic Eagle reverse.*1986\s*–\s*2021/
    );
    await expect(settingsRow(page, "ase-type2")).toContainText(
      /Type 2.*Landing Eagle reverse.*2021\s*–\s*present/
    );
    await expect(page.locator(".modal:visible")).toHaveCount(1);
    await closeSettingsCollections(page);

    // The Settings API route opens the same panel inside the same modal.
    await openSettingsCollections(page, "direct");
    await expect(page.locator("#settingsModal #settingsPanel_collections")).toBeVisible();
    await expect(page.locator(".modal:visible")).toHaveCount(1);
  });

  test("On/Off hides empty template and Custom Collection in Album and Ledger, survives reload, and restores both", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const customId = await page.evaluate(() => {
      const created = window.collectionsStore.createCustom({
        name: "Toggle Morgan Set",
        metal: "Silver",
        slots: [{ label: "One" }],
      });
      window.collectionsStore.link("ase-type1", "2022", "col-ase-2022-a");
      return created.collection.id;
    });
    await openCollectionsTab(page);
    const storedCollectionsBefore = await page.evaluate(() => ({
      collectionState: localStorage.getItem("collectionState"),
      inventory: localStorage.getItem("metalInventory"),
    }));
    const pageOrigin = new URL(page.url()).origin;
    const networkRequests = [];
    let loadEvents = 0;
    page.on("load", () => {
      loadEvents++;
    });
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== pageOrigin) networkRequests.push(request.url());
    });
    const pageUrl = page.url();
    let settings = await openSettingsCollections(page);
    for (const label of ["American Silver Eagle Type 2", "Toggle Morgan Set"]) {
      const group = settingsVisibilityGroup(page, label);
      await group.getByRole("button", { name: "Off", exact: true }).click();
      await expect(group.getByRole("button", { name: "Off", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    }
    await closeSettingsCollections(page);
    expect(
      await page.evaluate(() => ({
        collectionState: localStorage.getItem("collectionState"),
        inventory: localStorage.getItem("metalInventory"),
      }))
    ).toEqual(storedCollectionsBefore);

    for (const id of ["ase-type2", customId]) {
      await expect(panel(page).locator(`[data-collection-id="${id}"]`)).toHaveCount(0);
    }
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    for (const id of ["ase-type2", customId]) {
      await expect(panel(page).locator(`[data-collection-id="${id}"]`)).toHaveCount(0);
    }
    expect(page.url()).toBe(pageUrl);
    expect(loadEvents).toBe(0);
    expect(networkRequests).toEqual([]);

    await reloadApp(page);
    await openCollectionsTab(page);
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    for (const id of ["ase-type2", customId]) {
      await expect(panel(page).locator(`[data-collection-id="${id}"]`)).toHaveCount(0);
    }

    settings = await openSettingsCollections(page);
    for (const label of ["American Silver Eagle Type 2", "Toggle Morgan Set"]) {
      const group = settingsVisibilityGroup(page, label);
      await group.getByRole("button", { name: "On", exact: true }).click();
      await expect(group.getByRole("button", { name: "On", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    }
    await closeSettingsCollections(page);
    for (const id of ["ase-type2", customId]) {
      await expect(panel(page).locator(`[data-collection-id="${id}"]`)).toBeVisible();
    }
  });

  test("a failed preference save shows the error and keeps the last saved visibility value", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const settings = await openSettingsCollections(page);
    const group = settingsVisibilityGroup(page, "American Silver Eagle Type 1");
    await group.getByRole("button", { name: "Off", exact: true }).click();
    await expect(group.getByRole("button", { name: "Off", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const savedPreference = await page.evaluate(() => localStorage.getItem("disabledCollections"));

    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "disabledCollections") throw new Error("simulated preference write failure");
        return originalSetItem.call(this, key, value);
      };
    });
    await settingsVisibilityGroup(page, "American Silver Eagle Type 1")
      .getByRole("button", { name: "On", exact: true })
      .click();

    await expect(
      page
        .locator(".cloud-toast")
        .filter({ hasText: "Couldn't save the Collection setting. Try again." })
    ).toBeVisible();
    const rerenderedGroup = settingsVisibilityGroup(page, "American Silver Eagle Type 1");
    await expect(rerenderedGroup.getByRole("button", { name: "Off", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(rerenderedGroup.getByRole("button", { name: "On", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(await page.evaluate(() => localStorage.getItem("disabledCollections"))).toBe(
      savedPreference
    );
    await expect(rerenderedGroup.getByRole("button", { name: "On", exact: true })).toBeFocused();
  });

  test("a populated row stays On with disabled controls and an accessible linked-Item/Spare reason", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2022", "col-ase-2022-a");
      window.collectionsStore.link("ase-type2", "2022", "col-ase-2022-b", { asSpare: true });
    });

    const settings = await openSettingsCollections(page);
    const group = settingsVisibilityGroup(page, "American Silver Eagle Type 2");
    const on = group.getByRole("button", { name: "On", exact: true });
    const off = group.getByRole("button", { name: "Off", exact: true });
    await expect(on).toBeDisabled();
    await expect(off).toBeDisabled();
    await expect(on).toHaveAttribute("aria-pressed", "true");
    const descriptionId = await group.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    const reason = page.locator(`#${descriptionId}`);
    await expect(reason).toContainText("2 linked Items");
    await expect(reason).toContainText("incl. 1 Spare");
    await expect(reason).toContainText("unlink them to turn off");
  });

  test("a populated row stays locked and stacked at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedAndGoto(page);
    await page.evaluate(() => {
      window.collectionsStore.link("ase-type2", "2022", "col-ase-2022-a");
      window.collectionsStore.link("ase-type2", "2022", "col-ase-2022-b", { asSpare: true });
    });

    const settings = await openSettingsCollections(page);
    const row = settings.locator('.collections-settings-row[data-collection-id="ase-type2"]');
    const group = settingsVisibilityGroup(page, "American Silver Eagle Type 2");
    const on = group.getByRole("button", { name: "On", exact: true });
    const off = group.getByRole("button", { name: "Off", exact: true });
    const reason = row.locator(".collections-settings-reason");
    await expect(on).toBeDisabled();
    await expect(off).toBeDisabled();
    await expect(reason).toContainText("2 linked Items (incl. 1 Spare)");
    await expect(reason).toContainText("unlink them to turn off");

    const nameBox = await row.locator(".collections-settings-name").boundingBox();
    const progressBox = await row.locator(".collections-settings-progress").boundingBox();
    const toggleBox = await group.boundingBox();
    const actionBox = await row.locator(".collections-settings-action").boundingBox();
    expect(progressBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);
    expect(toggleBox.y).toBeGreaterThanOrEqual(progressBox.y + progressBox.height);
    expect(Math.abs(actionBox.y - toggleBox.y)).toBeLessThanOrEqual(2);
    expect((await on.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect((await off.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(
      await row.evaluate((element) => element.scrollWidth - element.clientWidth)
    ).toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ).toBeLessThanOrEqual(0);
  });

  test("empty Custom Collection with Slot artwork can be hidden and its artwork returns when turned back on", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const art = await page.evaluate(async () => {
      const created = window.collectionsStore.createCustom({
        name: "Peace Artwork Collection",
        metal: "Silver",
        slots: [{ label: "First" }],
      });
      const collectionId = created.collection.id;
      const slotId = created.collection.definition.slots[0].id;
      const image = await fetch("/tests/playwright/helpers/test-obverse.png").then((r) => r.blob());
      const saved = await window.collectionsPicker.saveImage(
        collectionId,
        slotId,
        new File([image], "art.png", { type: "image/png" })
      );
      if (!saved) throw new Error("Slot artwork upload failed");
      return { collectionId, slotId };
    });
    await openCollectionsTab(page);
    const settings = await openSettingsCollections(page);
    const group = settingsVisibilityGroup(page, "Peace Artwork Collection");
    await group.getByRole("button", { name: "Off", exact: true }).click();
    await expect(settings).toContainText("Slot artwork is kept and returns when turned back on.");
    await group.getByRole("button", { name: "On", exact: true }).click();
    await expect(group.getByRole("button", { name: "On", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await closeSettingsCollections(page);

    await panel(page).locator(`[data-collection-id="${art.collectionId}"]`).click();
    await expect(page.locator("#collectionsSectionEl [data-slot-id]")).toHaveCount(1);
    await expect(
      page.locator(`#collectionsSectionEl [data-slot-id="${art.slotId}"] .collections-coin img`)
    ).toHaveAttribute("src", /^blob:/);
  });

  test("Custom Edit stays over Settings and refreshes the row; template Clone seeds the builder without Edit or Remove", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const customId = await page.evaluate(
      () =>
        window.collectionsStore.createCustom({
          name: "Before Edit",
          metal: "Silver",
          slots: [{ label: "One" }],
        }).collection.id
    );
    const settings = await openSettingsCollections(page);
    await expect(settings.getByRole("button", { name: "Edit Before Edit" })).toBeVisible();
    await expect(
      settings.getByRole("button", { name: /Clone and customize.*American Silver Eagle Type 2/ })
    ).toBeVisible();
    await expect(settings.getByRole("button", { name: /Edit American Silver Eagle/ })).toHaveCount(
      0
    );
    await expect(settings.getByRole("button", { name: /Remove/ })).toHaveCount(0);

    const editTrigger = settings.getByRole("button", { name: "Edit Before Edit" });
    const originalEditTrigger = await editTrigger.elementHandle();
    expect(originalEditTrigger).toBeTruthy();
    const builder = page.locator("#collectionsBuilderModal");
    const openEdit = async () => {
      await editTrigger.focus();
      await page.keyboard.press("Enter");
      await expect(builder).toBeVisible();
    };

    await openEdit();
    const cancel = builder.getByRole("button", { name: "Cancel" });
    await cancel.focus();
    await page.keyboard.press("Enter");
    await expect(builder).toBeHidden();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await expect(editTrigger).toBeFocused();
    await expect(page.locator("#settingsModal")).toBeVisible();
    expect(await originalEditTrigger.evaluate((button) => button.isConnected)).toBe(true);

    await openEdit();
    await page.keyboard.press("Escape");
    await expect(builder).toBeHidden();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await expect(editTrigger).toBeFocused();
    await expect(page.locator("#settingsModal")).toBeVisible();
    expect(await originalEditTrigger.evaluate((button) => button.isConnected)).toBe(true);

    await openEdit();
    await expect(page.locator("#settingsModal")).toBeVisible();
    await expect(builder).toBeVisible();
    await builder.getByLabel("Collection name").fill("After Edit");
    const saveChanges = builder.getByRole("button", { name: "Save changes" });
    await saveChanges.focus();
    await page.keyboard.press("Enter");
    await expect(builder).toBeHidden();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    const refreshedEdit = settings.getByRole("button", { name: "Edit After Edit" });
    await expect(refreshedEdit).toBeVisible();
    await expect(refreshedEdit).toBeFocused();
    expect(await originalEditTrigger.evaluate((button) => button.isConnected)).toBe(false);
    expect(
      await page.evaluate((id) => window.collectionsStore.getState().collections[id].name, customId)
    ).toBe("After Edit");

    await closeSettingsCollections(page);
    await openSettingsCollections(page);
    await settingsCollectionsPanel(page)
      .getByRole("button", { name: /Clone and customize.*American Silver Eagle Type 2/ })
      .click();
    await expect(page.locator("#settingsModal")).toBeHidden();
    await expect(builder).toBeVisible();
    await expect(builder.getByLabel("Slot label")).toHaveCount(6);
    await expect(builder.getByLabel("Slot label").first()).toHaveValue("2021 T2");
  });

  test("store reload refreshes open hub and Settings after a visibility preference changes", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const customId = await page.evaluate(
      () =>
        window.collectionsStore.createCustom({
          name: "Refresh Custom",
          metal: "Silver",
          slots: [{ label: "One" }],
        }).collection.id
    );
    await openCollectionsTab(page);
    await expect(panel(page).locator(`[data-collection-id="${customId}"]`)).toBeVisible();
    const settings = await openSettingsCollections(page);
    const group = settingsVisibilityGroup(page, "Refresh Custom");
    await expect(group.getByRole("button", { name: "On", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await page.evaluate((id) => {
      saveDataSync("disabledCollections", [id]);
      window.collectionsStore.reload();
    }, customId);

    await expect(group.getByRole("button", { name: "Off", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(panel(page).locator(`[data-collection-id="${customId}"]`)).toHaveCount(0);
  });

  test("status filters include enabled Collections only, while an empty hidden row keeps its progress", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await linkItems(page, [["2024", "col-ase-2024"]]);
    const progressRow = panel(page).locator(
      '[data-collection-id="ase-type2"] .collections-card-row'
    );
    const countBefore = await progressRow.locator(".collections-count").innerText();
    const percentageBefore = await progressRow.locator(".collections-pct").innerText();
    const settings = await openSettingsCollections(page);
    const hidden = settingsVisibilityGroup(page, "American Silver Eagle Type 1");
    await hidden.getByRole("button", { name: "Off", exact: true }).click();
    await closeSettingsCollections(page);

    await panel(page).getByRole("button", { name: "Not started", exact: true }).click();
    await expect(panel(page).locator('[data-collection-id="ase-type1"]')).toHaveCount(0);
    await expect(panel(page).locator('[data-collection-id="ase-type2"]')).toHaveCount(0);
    await panel(page).getByRole("button", { name: "In progress", exact: true }).click();
    await expect(panel(page).locator('[data-collection-id="ase-type2"]')).toBeVisible();
    const filteredProgressRow = panel(page).locator(
      '[data-collection-id="ase-type2"] .collections-card-row'
    );
    await expect(filteredProgressRow.locator(".collections-count")).toHaveText(countBefore);
    await expect(filteredProgressRow.locator(".collections-pct")).toHaveText(percentageBefore);

    const reopened = await openSettingsCollections(page);
    await expect(
      reopened.locator(
        '.collections-settings-row[data-collection-id="ase-type1"] .collections-settings-progress'
      )
    ).toContainText("0 / 36");
    await expect(
      reopened.locator(
        '.collections-settings-row[data-collection-id="ase-type2"] .collections-settings-progress'
      )
    ).toContainText("1 / 6");
  });

  test("all-off recovery works in Album and Ledger with no lone New collection card", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    const settings = await openSettingsCollections(page);
    for (const label of ["American Silver Eagle Type 1", "American Silver Eagle Type 2"]) {
      await settingsVisibilityGroup(page, label)
        .getByRole("button", { name: "Off", exact: true })
        .click();
    }
    await closeSettingsCollections(page);

    for (const view of ["Album", "Ledger"]) {
      if (view === "Ledger") {
        await panel(page).getByRole("button", { name: "Ledger view" }).click();
      }
      await expect(
        panel(page).getByRole("heading", { name: "All Collections are turned off" })
      ).toBeVisible();
      await expect(panel(page)).toContainText(
        "Nothing was deleted. Turn Collections back on in Settings, or start a new one."
      );
      await expect(panel(page).locator(".collections-card.is-new")).toHaveCount(0);
      await panel(page).getByRole("button", { name: "Open Collections settings" }).click();
      await expect(settingsCollectionsPanel(page)).toBeVisible();
      await closeSettingsCollections(page);
    }
  });

  test("hidden-count link and toolbar Manage both open Settings Collections", async ({ page }) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    const settings = await openSettingsCollections(page);
    await settingsVisibilityGroup(page, "American Silver Eagle Type 1")
      .getByRole("button", { name: "Off", exact: true })
      .click();
    await closeSettingsCollections(page);

    await expect(panel(page)).toContainText("1 hidden · Manage in Settings");
    await panel(page).getByRole("button", { name: "Manage in Settings" }).click();
    await expect(settingsCollectionsPanel(page)).toBeVisible();
    await closeSettingsCollections(page);
    await panel(page).getByRole("button", { name: "Manage", exact: true }).click();
    await expect(settingsCollectionsPanel(page)).toBeVisible();
  });

  test("a hidden Collection deep link falls back to the hub and corrects the URL", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("disabledCollections", JSON.stringify(["ase-type2"]))
    );
    await seedAndGoto(page);
    await page.goto("/index.html#/collections/ase-type2");

    await expect(page.locator("#collectionsSectionEl")).toBeVisible();
    await expect(
      page.locator('#collectionsSectionEl [data-collection-id="ase-type2"]')
    ).toHaveCount(0);
    await expect(page).toHaveURL(/#\/collections$/);
  });

  test("Collections Settings remains usable at 375px in all four themes with 44px controls", async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 375, height: 812 });
    await seedAndGoto(page);
    await page.evaluate(() =>
      window.collectionsStore.createCustom({
        name: "Responsive Custom",
        metal: "Silver",
        slots: [{ label: "One" }],
      })
    );
    const settings = await openSettingsCollections(page);
    for (const theme of ["dark", "light", "slate", "sepia"]) {
      await page.evaluate((value) => window.setTheme(value), theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(settings.getByRole("heading", { name: "Collections" })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      ).toBeLessThanOrEqual(0);
    }
    const targets = [
      settingsVisibilityGroup(page, "American Silver Eagle Type 2").getByRole("button", {
        name: "On",
        exact: true,
      }),
      settingsVisibilityGroup(page, "American Silver Eagle Type 2").getByRole("button", {
        name: "Off",
        exact: true,
      }),
      settings.getByRole("button", { name: "Edit Responsive Custom" }),
    ];
    for (const target of targets) {
      const height = await target.evaluate((element) => element.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(44);
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
const albumNames = (page) =>
  panel(page).locator(".collections-card[data-collection-id] .collections-card-name b");
const albumIds = (page) =>
  panel(page)
    .locator(".collections-card[data-collection-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.collectionId));
const ledgerIds = (page) =>
  panel(page)
    .locator(".collections-hubrow[data-collection-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.collectionId));

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
    const defaultDirection =
      label === "Progress" || label === "Owned" || label === "Value (melt)" ? "desc" : "asc";
    const presetOrder = defaultDirection === "asc" ? ascending : descending;
    const reversedOrder = defaultDirection === "asc" ? descending : ascending;
    test(`${label} header selects its preset direction and then reverses`, async ({ page }) => {
      await seedSortableHub(page);
      const header = panel(page).getByRole("button", {
        name: `Sort by ${label}, not sorted`,
        exact: true,
      });
      await header.click();
      await expect(ledgerNames(page)).toHaveText(presetOrder);
      await panel(page)
        .getByRole("button", {
          name: `Sort by ${label}, ${defaultDirection === "asc" ? "ascending" : "descending"}`,
          exact: true,
        })
        .click();
      await expect(ledgerNames(page)).toHaveText(reversedOrder);
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
      name: "Sort by Owned, descending",
      exact: true,
    });
    await expect(active).toBeFocused();
    await active.press("Space");
    await expect(ledgerNames(page)).toHaveText(hubSortCases[2][1]);
    await panel(page).getByRole("button", { name: "In progress", exact: true }).click();
    await expect(ledgerNames(page)).toHaveText(["Zeta", "Beta", "Unknown", "Alpha"]);
    await panel(page).getByRole("button", { name: "Complete", exact: true }).click();
    await expect(panel(page)).toContainText("No collections match this filter");
    await panel(page).getByRole("button", { name: "All", exact: true }).click();
    await expect(ledgerNames(page)).toHaveText(hubSortCases[2][1]);
    await panel(page).getByRole("button", { name: "Album view" }).click();
    await expect(panel(page).locator(".collections-card-name b")).toHaveText(hubSortCases[2][1]);
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    await expect(ledgerNames(page)).toHaveText(hubSortCases[2][1]);
    expect(await page.evaluate(() => JSON.stringify(window.collectionsStore.getState()))).toBe(
      saved
    );
  });

  // STRK-378 AC 11: the phone Ledger hides its header row, so the compact select carries
  // My order plus every column in both directions, and the Arrange icon sits beside it.
  test("mobile Sort offers My order and every column in both directions, beside Arrange", async ({
    page,
  }) => {
    await seedSortableHub(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel(page).locator(".is-head")).toBeHidden();
    const select = panel(page).getByRole("combobox", { name: "Sort collections" });
    await expect(select).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: "Arrange Collections", exact: true })
    ).toBeVisible();
    const columns = hubSortCases.map(([label]) => label);
    await expect(select.locator("option")).toHaveText([
      "My order",
      ...columns.flatMap((label) => [`${label} — ascending`, `${label} — descending`]),
    ]);
    const keys = ["name", "percent-complete", "owned", "value-melt", "to-complete"];
    for (let i = 0; i < hubSortCases.length; i++) {
      await select.selectOption(`${keys[i]}:asc`);
      await expect(ledgerNames(page)).toHaveText(hubSortCases[i][1]);
      await select.selectOption(`${keys[i]}:desc`);
      await expect(ledgerNames(page)).toHaveText(hubSortCases[i][2]);
    }
    await select.selectOption("my-order");
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
    await expect(ledgerNames(page)).toHaveText(hubSortCases[1][2]);
    await expect(
      panel(page).getByRole("button", { name: "Sort by Progress, descending", exact: true })
    ).toBeVisible();
    await panel(page).screenshot({ path: testInfo.outputPath(`hub-${theme}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page).getByRole("combobox", { name: "Sort collections" })).toBeVisible();
  await panel(page).screenshot({ path: testInfo.outputPath("hub-mobile.png") });
});

// ---------------------------------------------------------------------------
// STRK-378 (revised 2026-09-26): My order lives in Settings → Collections, the Ledger
// header carries a compact Arrange control, and the Album follows the active sort with a
// column-label hint. AC numbers refer to the STRK-378 issue.
// ---------------------------------------------------------------------------

/**
 * Collection ids of the Settings rows in rendered order.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<string[]>} Row ids.
 */
const settingsRowIds = (page) =>
  settingsCollectionsPanel(page)
    .locator(".collections-settings-row[data-collection-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.collectionId));

/**
 * Accessible row labels (name plus template variant) in rendered Settings order.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<string[]>} Row labels, as used by the row's controls.
 */
const settingsRowLabels = (page) =>
  settingsCollectionsPanel(page)
    .locator(".collections-settings-row[data-collection-id] .collections-settings-toggle")
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        node.getAttribute("aria-label").replace(/^Show (.*) in Collections$/, "$1")
      )
    );

/**
 * One Settings row by Collection id.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {string} id - Collection id.
 * @returns {import('@playwright/test').Locator} The row.
 */
const settingsRow = (page, id) =>
  settingsCollectionsPanel(page).locator(`.collections-settings-row[data-collection-id="${id}"]`);

/**
 * The Ledger header's icon-only Arrange control.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {import('@playwright/test').Locator} The Arrange button.
 */
const arrangeButton = (page) =>
  panel(page).getByRole("button", { name: "Arrange Collections", exact: true });

/**
 * The persisted hub preference record.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<{order: string[], sortKey: string, direction: string}|null>} Stored record.
 */
const storedHubPreferences = (page) =>
  page.evaluate(() => window.loadDataSync(window.COLLECTIONS_HUB_PREFERENCES_KEY, null));

/**
 * Create empty Custom Collections through the real store.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {string[]} names - Collection names.
 * @returns {Promise<string[]>} New Collection ids.
 */
const createCustomCollections = (page, names) =>
  page.evaluate(
    (list) =>
      list.map((name) => {
        const created = window.collectionsStore.createCustom({
          name,
          metal: "Silver",
          slots: [{ label: "One" }],
        });
        if (!created.ok) throw new Error(`Fixture creation failed: ${created.reason}`);
        return created.collection.id;
      }),
    names
  );

/**
 * Drag a handle onto the upper or lower half of a target with real pointer events.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {import('@playwright/test').Locator} handle - Drag handle.
 * @param {import('@playwright/test').Locator} target - Row to drop on.
 * @param {boolean} lowerHalf - Drop after the target instead of before it.
 * @returns {Promise<void>}
 */
const dragHandleTo = async (page, handle, target, lowerHalf) => {
  await target.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height * (lowerHalf ? 0.8 : 0.2),
    { steps: 6 }
  );
  await page.mouse.up();
};

/**
 * Make every write of the hub preference key throw, recording toasts instead of showing them.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>}
 */
const failHubPreferenceSaves = (page) =>
  page.evaluate(() => {
    window.__hubPreferenceErrors = [];
    window.__originalShowToast = window.showToast;
    window.showToast = (message, level) => window.__hubPreferenceErrors.push({ message, level });
    window.__originalStorageSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === window.COLLECTIONS_HUB_PREFERENCES_KEY)
        throw new DOMException("Storage full", "QuotaExceededError");
      return window.__originalStorageSetItem.call(this, key, value);
    };
  });

/**
 * Undo failHubPreferenceSaves.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>}
 */
const restoreHubPreferenceSaves = (page) =>
  page.evaluate(() => {
    Storage.prototype.setItem = window.__originalStorageSetItem;
    window.showToast = window.__originalShowToast;
  });

const FIXTURE_ORDER = ledgerFixtures.map((entry) => entry.name);

test.describe("core/collections — STRK-378 My order and hub sorting", () => {
  test("Settings shows one My order list with Type badges, chronological on a fresh profile", async ({
    page,
  }) => {
    await seedAndGoto(page);
    const [morganId] = await createCustomCollections(page, ["Morgan Carson City"]);
    const fallback = await page.evaluate(() =>
      window.collectionsUI.buildEntries().map((entry) => entry.id)
    );
    const settings = await openSettingsCollections(page);

    // AC 1: one list, not a Series Templates / Custom Collections split.
    await expect(settings.locator(".settings-fieldset")).toHaveCount(1);
    await expect(settings.locator(".settings-fieldset")).toContainText("My order");
    await expect(settings).not.toContainText("Series Templates");
    const ids = await settingsRowIds(page);
    expect(ids).toEqual(fallback);
    expect(ids.indexOf("ase-type1")).toBeLessThan(ids.indexOf("ase-type2"));
    expect(ids).toContain(morganId);

    // AC 2: Type badge, progress, visibility toggle and the type-specific action.
    const type1 = settingsRow(page, "ase-type1");
    await expect(type1.getByText("Template", { exact: true })).toBeVisible();
    await expect(type1).toContainText("0 / 36");
    await expect(settingsVisibilityGroup(page, "American Silver Eagle Type 1")).toBeVisible();
    await expect(
      type1.getByRole("button", { name: "Clone and customize American Silver Eagle Type 1" })
    ).toBeVisible();
    const morgan = settingsRow(page, morganId);
    await expect(morgan.getByText("Custom", { exact: true })).toBeVisible();
    await expect(morgan).toContainText("0 / 1");
    await expect(morgan.getByRole("button", { name: "Edit Morgan Carson City" })).toBeVisible();
  });

  test("Settings move buttons save at once, announce, keep focus, and drive the hub", async ({
    page,
  }) => {
    await seedSortableHub(page);
    await panel(page).getByRole("button", { name: "Album view" }).click();
    await openSettingsCollections(page);
    expect(await settingsRowLabels(page)).toEqual(FIXTURE_ORDER);

    // AC 3: edge buttons are disabled.
    const settings = settingsCollectionsPanel(page);
    await expect(
      settings.getByRole("button", { name: "Move Zeta up", exact: true })
    ).toBeDisabled();
    await expect(
      settings.getByRole("button", { name: "Move Unknown down", exact: true })
    ).toBeDisabled();
    await expect(
      settings.getByRole("button", { name: "Drag Zeta to reorder", exact: true })
    ).toBeVisible();

    // AC 4 + 6: a move saves immediately, is announced, and keeps focus on its control.
    const zetaDown = settings.getByRole("button", { name: "Move Zeta down", exact: true });
    await zetaDown.focus();
    await zetaDown.press("Enter");
    const moved = ["Alpha", "Zeta", "Beta", "Delta", "Unknown"];
    await expect.poll(() => settingsRowLabels(page)).toEqual(moved);
    await expect(settings.getByRole("status")).toContainText("Zeta moved to position 2 of 5.");
    await expect(
      settings.getByRole("button", { name: "Move Zeta down", exact: true })
    ).toBeFocused();
    expect((await storedHubPreferences(page)).order).toEqual([
      "alpha",
      "zeta",
      "beta",
      "delta",
      "unknown",
    ]);

    // AC 6: reaching the bottom edge hands focus to the opposite button.
    for (let step = 0; step < 3; step += 1) {
      await settings.getByRole("button", { name: "Move Zeta down", exact: true }).click();
    }
    const bottom = ["Alpha", "Beta", "Delta", "Unknown", "Zeta"];
    await expect.poll(() => settingsRowLabels(page)).toEqual(bottom);
    await expect(settings.getByRole("button", { name: "Move Zeta up", exact: true })).toBeFocused();

    // AC 15: the open hub follows without a reload. (Reload persistence is pinned by the
    // real-template test below: this fixture's bundle is injected after load and would not
    // survive a reload.)
    await closeSettingsCollections(page);
    await expect(albumNames(page)).toHaveText(bottom);
  });

  test("My order and the active sort survive a reload, and Show My order persists", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await createCustomCollections(page, ["Morgan Carson City"]);
    await openCollectionsTab(page);
    await panel(page).getByRole("button", { name: "Album view" }).click();
    const settings = await openSettingsCollections(page);
    const before = await settingsRowIds(page);
    await settings
      .getByRole("button", { name: "Move American Silver Eagle Type 2 up", exact: true })
      .click();
    const arranged = await settingsRowIds(page);
    expect(arranged).not.toEqual(before);
    expect(arranged.indexOf("ase-type2")).toBe(before.indexOf("ase-type2") - 1);
    await closeSettingsCollections(page);
    await expect.poll(() => albumIds(page)).toEqual(arranged);

    // AC 5: the saved order renders after a reload in Settings and the hub.
    await reloadApp(page);
    await openCollectionsTab(page);
    await expect.poll(() => albumIds(page)).toEqual(arranged);
    await openSettingsCollections(page);
    expect(await settingsRowIds(page)).toEqual(arranged);
    await closeSettingsCollections(page);

    // AC 7 + 13: a header sort survives a reload and the Album keeps its hint.
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    await panel(page)
      .getByRole("button", { name: "Sort by Collection, not sorted", exact: true })
      .click();
    await reloadApp(page);
    await openCollectionsTab(page);
    await expect(
      panel(page).getByRole("button", { name: "Sort by Collection, ascending", exact: true })
    ).toBeVisible();
    await panel(page).getByRole("button", { name: "Album view" }).click();
    await expect(panel(page).locator(".collections-sort-hint")).toContainText(
      "Sorted by Collection, ascending"
    );

    // AC 14: Show My order is saved too.
    await panel(page).getByRole("button", { name: "Show My order", exact: true }).click();
    await reloadApp(page);
    await openCollectionsTab(page);
    await expect(panel(page).locator(".collections-sort-hint")).toHaveCount(0);
    await expect.poll(() => albumIds(page)).toEqual(arranged);
  });

  test("a Settings drag handle drops a row before or after its target", async ({ page }) => {
    await seedSortableHub(page);
    await openSettingsCollections(page);
    const settings = settingsCollectionsPanel(page);
    await dragHandleTo(
      page,
      settings.getByRole("button", { name: "Drag Zeta to reorder", exact: true }),
      settingsRow(page, "delta"),
      true
    );
    await expect
      .poll(() => settingsRowLabels(page))
      .toEqual(["Alpha", "Beta", "Delta", "Zeta", "Unknown"]);
    await dragHandleTo(
      page,
      settings.getByRole("button", { name: "Drag Unknown to reorder", exact: true }),
      settingsRow(page, "alpha"),
      false
    );
    await expect
      .poll(() => settingsRowLabels(page))
      .toEqual(["Unknown", "Alpha", "Beta", "Delta", "Zeta"]);
    expect((await storedHubPreferences(page)).order).toEqual([
      "unknown",
      "alpha",
      "beta",
      "delta",
      "zeta",
    ]);
  });

  test("a hidden Collection keeps its Settings position while the hub leaves it out", async ({
    page,
  }) => {
    await seedSortableHub(page);
    await panel(page).getByRole("button", { name: "Album view" }).click();
    await page.evaluate(() => {
      const result = window.collectionsStore.setEnabled("delta", false);
      if (!result.ok) throw new Error(JSON.stringify(result));
    });
    await expect(albumNames(page)).toHaveText(["Zeta", "Alpha", "Beta", "Unknown"]);

    await openSettingsCollections(page);
    expect(await settingsRowLabels(page)).toEqual(FIXTURE_ORDER);
    await settingsCollectionsPanel(page)
      .getByRole("button", { name: "Move Unknown up", exact: true })
      .click();
    // Unknown passes the hidden Delta row; Delta stays listed and keeps its slot.
    await expect
      .poll(() => settingsRowLabels(page))
      .toEqual(["Zeta", "Alpha", "Beta", "Unknown", "Delta"]);
    await closeSettingsCollections(page);
    await expect(albumNames(page)).toHaveText(["Zeta", "Alpha", "Beta", "Unknown"]);

    await page.evaluate(() => window.collectionsStore.setEnabled("delta", true));
    await expect(albumNames(page)).toHaveText(["Zeta", "Alpha", "Beta", "Unknown", "Delta"]);
  });

  test("a failed Settings order save reports the error and keeps the saved order", async ({
    page,
  }) => {
    await seedSortableHub(page);
    await openSettingsCollections(page);
    const before = await storedHubPreferences(page);
    await failHubPreferenceSaves(page);
    const settings = settingsCollectionsPanel(page);
    await settings.getByRole("button", { name: "Move Zeta down", exact: true }).click();
    await expect(settings.getByRole("status")).toContainText("Couldn't save the new order");
    expect(await settingsRowLabels(page)).toEqual(FIXTURE_ORDER);
    expect(await storedHubPreferences(page)).toEqual(before);
    await restoreHubPreferenceSaves(page);
  });

  test("Ledger Arrange shows under All only; Done saves My order and Cancel discards", async ({
    page,
  }) => {
    await seedSortableHub(page);
    // AC 8: the icon-only control lives in the Ledger header, under the All filter only.
    await expect(arrangeButton(page)).toBeVisible();
    await panel(page).getByRole("button", { name: "In progress", exact: true }).click();
    await expect(arrangeButton(page)).toHaveCount(0);
    await panel(page).getByRole("button", { name: "All", exact: true }).click();
    await panel(page)
      .getByRole("button", { name: "Sort by Owned, not sorted", exact: true })
      .click();
    await expect(ledgerNames(page)).toHaveText(hubSortCases[2][2]);

    // AC 9: arranging shows My order, disables header sorting, and swaps in Done / Cancel.
    await arrangeButton(page).focus();
    await arrangeButton(page).press("Enter");
    await expect(panel(page).getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await expect(panel(page).getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(arrangeButton(page)).toHaveCount(0);
    await expect(ledgerNames(page)).toHaveText(FIXTURE_ORDER);
    await expect(
      panel(page).getByRole("button", { name: "Sort by Owned, descending", exact: true })
    ).toBeDisabled();
    await panel(page).getByRole("button", { name: "Move Zeta down", exact: true }).click();
    const moved = ["Alpha", "Zeta", "Beta", "Delta", "Unknown"];
    await expect(ledgerNames(page)).toHaveText(moved);
    await expect(panel(page).getByRole("status")).toHaveText("Zeta moved to position 2 of 5.");

    // AC 10: Cancel discards the draft and restores the previous sort and filter.
    await panel(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(arrangeButton(page)).toBeFocused();
    await expect(ledgerNames(page)).toHaveText(hubSortCases[2][2]);
    await expect(panel(page).getByRole("button", { name: "All", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // AC 10: Done saves the draft as My order and makes My order the active sort.
    await arrangeButton(page).click();
    await panel(page).getByRole("button", { name: "Move Zeta down", exact: true }).click();
    await panel(page).getByRole("button", { name: "Done", exact: true }).click();
    await expect(arrangeButton(page)).toBeFocused();
    await expect(ledgerNames(page)).toHaveText(moved);
    await expect(
      panel(page).getByRole("button", { name: "Sort by Owned, not sorted", exact: true })
    ).toBeVisible();
    expect(await storedHubPreferences(page)).toMatchObject({
      sortKey: "my-order",
      order: ["alpha", "zeta", "beta", "delta", "unknown"],
    });
  });

  test("Ledger arrange moves keep keyboard focus at both edges", async ({ page }) => {
    await seedSortableHub(page);
    await arrangeButton(page).click();
    const down = panel(page).getByRole("button", { name: "Move Zeta down", exact: true });
    for (let step = 0; step < FIXTURE_ORDER.length - 1; step += 1) await down.click();
    await expect(ledgerNames(page)).toHaveText([...FIXTURE_ORDER.slice(1), "Zeta"]);
    const up = panel(page).getByRole("button", { name: "Move Zeta up", exact: true });
    await expect(up).toBeFocused();
    for (let step = 0; step < FIXTURE_ORDER.length - 1; step += 1) await up.click();
    await expect(ledgerNames(page)).toHaveText(FIXTURE_ORDER);
    await expect(
      panel(page).getByRole("button", { name: "Move Zeta down", exact: true })
    ).toBeFocused();
  });

  test("Ledger drag handles reorder rows while arranging", async ({ page }) => {
    await seedSortableHub(page);
    await arrangeButton(page).click();
    await dragHandleTo(
      page,
      panel(page).getByRole("button", { name: "Drag Zeta to reorder", exact: true }),
      panel(page).locator('[data-hub-arrange-id="unknown"]'),
      true
    );
    await expect.poll(() => ledgerIds(page)).toEqual(["alpha", "beta", "delta", "unknown", "zeta"]);
    await panel(page).getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await ledgerIds(page)).toEqual(["zeta", "alpha", "beta", "delta", "unknown"]);
  });

  test("a failed Ledger order save keeps Arrange open and reports the error", async ({ page }) => {
    await seedSortableHub(page);
    await arrangeButton(page).click();
    await panel(page).getByRole("button", { name: "Move Zeta down", exact: true }).click();
    await failHubPreferenceSaves(page);
    await panel(page).getByRole("button", { name: "Done", exact: true }).click();
    await expect(panel(page).getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(ledgerNames(page)).toHaveText(["Alpha", "Zeta", "Beta", "Delta", "Unknown"]);
    expect(
      await page.evaluate(() => window.__hubPreferenceErrors.some(({ level }) => level === "error"))
    ).toBe(true);
    await restoreHubPreferenceSaves(page);
    await panel(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(ledgerNames(page)).toHaveText(FIXTURE_ORDER);
  });

  test("the Album follows the active sort with a column-label hint and Show My order", async ({
    page,
  }) => {
    await seedSortableHub(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    const hint = panel(page).locator(".collections-sort-hint");
    const showMyOrder = panel(page).getByRole("button", { name: "Show My order", exact: true });

    // AC 12: no sort or arrange controls on the desktop toolbar, in either layout.
    for (const view of ["Album view", "Ledger view"]) {
      await panel(page).getByRole("button", { name: view }).click();
      await expect(panel(page).getByRole("combobox", { name: "Sort collections" })).toBeHidden();
      await expect(panel(page).getByRole("button", { name: /^Sort direction/ })).toHaveCount(0);
      await expect(panel(page).getByRole("button", { name: "Arrange", exact: true })).toHaveCount(
        0
      );
    }
    await panel(page).getByRole("button", { name: "Album view" }).click();
    await expect(arrangeButton(page)).toHaveCount(0);
    await expect(albumNames(page)).toHaveText(FIXTURE_ORDER);
    await expect(hint).toHaveCount(0);

    // AC 13: the Album follows a Ledger header sort and names it by the column label.
    // (Reload persistence: the real-template test above.)
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    await panel(page)
      .getByRole("button", { name: "Sort by Progress, not sorted", exact: true })
      .click();
    expect(await storedHubPreferences(page)).toMatchObject({
      sortKey: "percent-complete",
      direction: "desc",
    });
    await panel(page).getByRole("button", { name: "Album view" }).click();
    await expect(albumNames(page)).toHaveText(hubSortCases[1][2]);
    await expect(hint).toHaveText(/^Sorted by Progress, descending\s*·?\s*Show My order$/);

    // AC 14: Show My order resets, saves, and removes the hint.
    await showMyOrder.click();
    await expect(albumNames(page)).toHaveText(FIXTURE_ORDER);
    await expect(hint).toHaveCount(0);
    expect((await storedHubPreferences(page)).sortKey).toBe("my-order");
  });

  test("arrange controls, Type badges, and the hint work in four themes and at phone width", async ({
    page,
  }) => {
    await seedSortableHub(page);
    await panel(page)
      .getByRole("button", { name: "Sort by Owned, not sorted", exact: true })
      .click();
    const minSize = async (locator) => {
      const boxes = await locator.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect())
      );
      expect(boxes.length).toBeGreaterThan(0);
      return Math.min(...boxes.flatMap((box) => [box.width, box.height]));
    };
    for (const theme of ["dark", "light", "slate", "sepia"]) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute("data-theme", value),
        theme
      );
      for (const [width, height] of [
        [1280, 900],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await panel(page).getByRole("button", { name: "Album view" }).click();
        await expect(panel(page).locator(".collections-sort-hint")).toBeVisible();
        await panel(page).getByRole("button", { name: "Ledger view" }).click();
        await expect(arrangeButton(page)).toBeVisible();
        await arrangeButton(page).click();
        if (width < 640)
          expect(
            await minSize(panel(page).getByRole("button", { name: /^Move .* (up|down)$/ }))
          ).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        await panel(page).getByRole("button", { name: "Cancel", exact: true }).click();

        await openSettingsCollections(page);
        const settings = settingsCollectionsPanel(page);
        await expect(
          settingsRow(page, "zeta").getByText("Template", { exact: true })
        ).toBeVisible();
        await expect(
          settings.getByRole("button", { name: "Drag Zeta to reorder", exact: true })
        ).toBeVisible();
        if (width < 640)
          expect(
            await minSize(settings.getByRole("button", { name: /^Move .* (up|down)$/ }))
          ).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        await closeSettingsCollections(page);
      }
    }
  });
});

test.describe("STRK-391 Slot Mintage", () => {
  const builder = (page) => page.locator("#collectionsBuilderModal");
  const openBuilder = async (page, request = {}) => {
    await page.evaluate((value) => window.collectionsPicker.openBuilder(value), request);
    await expect(builder(page)).toBeVisible();
  };
  test("create, edit and clear Mintage in Album and Ledger after reload", async ({
    page,
  }, testInfo) => {
    await seedAndGoto(page);
    await openCollectionsTab(page);
    await openBuilder(page);
    await builder(page).getByLabel("Collection name").fill("Tuvalu variants");
    await builder(page).getByLabel("Slot label").nth(0).fill("2024 Proof");
    await builder(page).getByLabel("Mintage", { exact: true }).nth(0).fill(" 25000 ");
    await builder(page).getByLabel("Slot label").nth(1).fill("2024 BU");
    await builder(page).getByLabel("Mintage", { exact: true }).nth(1).fill("0");
    await builder(page).getByRole("button", { name: "Create collection", exact: true }).click();
    await expect(builder(page)).toBeHidden();
    await expect(panel(page)).toContainText("25,000 minted");
    await expect(panel(page)).toContainText("0 minted");
    await panel(page).screenshot({ path: testInfo.outputPath("mintage-album.png") });
    const id = await page.evaluate(
      () =>
        window.collectionsCore
          .listCollections(window.collectionsStore.getState())
          .find((c) => c.name === "Tuvalu variants").id
    );
    await page.evaluate((id) => {
      window.collectionsStore.link(id, "2024-proof", "col-ase-2024");
      window.collectionsStore.link(id, "2024-proof", "col-ase-2022-a");
    }, id);
    const before = await page.evaluate(
      (id) => window.collectionsStore.getState().collections[id].slots,
      id
    );
    await reloadCollections(page);
    await page.evaluate((id) => window.collectionsUI.openCollection(id), id);
    await panel(page).getByRole("button", { name: "Ledger view" }).click();
    await expect(panel(page)).toContainText("25,000");
    await panel(page).screenshot({ path: testInfo.outputPath("mintage-ledger.png") });
    await openBuilder(page, { editId: id });
    await expect(builder(page).getByLabel("Mintage", { exact: true }).nth(0)).toHaveValue("25000");
    await builder(page).getByLabel("Mintage", { exact: true }).nth(0).fill("12000");
    await builder(page).getByRole("button", { name: "Save changes" }).click();
    await expect(panel(page)).toContainText("12,000");
    await openBuilder(page, { editId: id });
    await builder(page).getByLabel("Mintage", { exact: true }).nth(0).fill("");
    await builder(page).getByRole("button", { name: "Save changes" }).click();
    await expect(panel(page)).not.toContainText("12,000");
    expect(
      await page.evaluate((id) => window.collectionsStore.getState().collections[id].slots, id)
    ).toEqual(before);
    await reloadCollections(page);
    await openBuilder(page, { editId: id });
    await expect(builder(page).getByLabel("Mintage", { exact: true }).nth(0)).toHaveValue("");
    await expect(builder(page).getByLabel("Mintage", { exact: true }).nth(1)).toHaveValue("0");
  });
  test("invalid Mintage keeps Save open, identifies the field and preserves state", async ({
    page,
  }, testInfo) => {
    await seedAndGoto(page);
    await openBuilder(page);
    await builder(page).getByLabel("Collection name").fill("Invalid counts");
    await builder(page).getByLabel("Slot label").first().fill("2024");
    const input = builder(page).getByLabel("Mintage", { exact: true }).first();
    const before = await page.evaluate(() => window.collectionsStore.getState());
    for (const value of ["-1", "1.5", "abc", "9007199254740992", "1e3", "0x10"]) {
      await input.fill(value);
      await builder(page).getByRole("button", { name: "Create collection", exact: true }).click();
      await expect(builder(page)).toBeVisible();
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(builder(page).getByRole("alert")).toContainText(
        "Mintage must be a whole number"
      );
      expect(await page.evaluate(() => window.collectionsStore.getState())).toEqual(before);
    }
    await builder(page).screenshot({ path: testInfo.outputPath("mintage-validation.png") });
    await input.fill("9007199254740991");
    await builder(page).getByRole("button", { name: "Create collection", exact: true }).click();
    await expect(builder(page)).toBeHidden();
  });
  test("template and Custom clones retain editable counts through reorder and insertion", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await openBuilder(page, { cloneFrom: "ase-type2" });
    const source = await page.evaluate(() =>
      window.__COLLECTIONS_BUNDLE.templates["ase-type2"].slots.map((s) => s.mintage)
    );
    const inputs = builder(page).getByLabel("Mintage", { exact: true });
    for (let i = 0; i < source.length; i++)
      await expect(inputs.nth(i)).toHaveValue(
        Number.isSafeInteger(source[i]) ? String(source[i]) : ""
      );
    await inputs.nth(0).fill("25000");
    await builder(page).getByLabel("Collection name").fill("Clone Mintage");
    await builder(page).getByRole("button", { name: "Move 2022 up", exact: true }).click();
    await expect(inputs.nth(1)).toHaveValue("25000");
    await builder(page)
      .getByRole("button", { name: /Add Slot after/ })
      .first()
      .click();
    await expect(inputs.nth(1)).toHaveValue("");
    await builder(page).getByLabel("Slot label").nth(1).fill("Variant");
    await inputs.nth(1).fill("500");
    await builder(page).getByRole("button", { name: "Create collection", exact: true }).click();
    const id = await page.evaluate(
      () =>
        window.collectionsCore
          .listCollections(window.collectionsStore.getState())
          .find((c) => c.name === "Clone Mintage").id
    );
    await openBuilder(page, { cloneFrom: id });
    await expect(inputs.nth(1)).toHaveValue("500");
    await expect(inputs.nth(2)).toHaveValue("25000");
    await inputs.nth(1).fill("600");
    await builder(page).getByRole("button", { name: "Create collection", exact: true }).click();
    expect(
      await page.evaluate(
        (id) => window.collectionsStore.getState().collections[id].definition.slots[1].mintage,
        id
      )
    ).toBe(500);
    expect(
      await page.evaluate(() =>
        window.__COLLECTIONS_BUNDLE.templates["ase-type2"].slots.map((s) => s.mintage)
      )
    ).toEqual(source);
  });
  test("Mintage fits desktop and 375px in four themes", async ({ page }, testInfo) => {
    await seedAndGoto(page);
    await openBuilder(page);
    await builder(page).getByLabel("Collection name").fill("Tuvalu variants");
    await builder(page).getByLabel("Slot label").first().fill("2024 Proof");
    await builder(page).getByLabel("Mintage", { exact: true }).first().fill("25000");
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark", "slate", "sepia"]) {
        await page.evaluate((theme) => window.setTheme(theme), theme);
        const input = builder(page).getByLabel("Mintage", { exact: true }).first();
        await expect(input).toBeVisible();
        const box = await input.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.width).toBeGreaterThan(75);
        expect(
          await builder(page).evaluate((modal) => modal.scrollWidth <= modal.clientWidth)
        ).toBe(true);
        if (width === 1280) {
          // Sample both positions in one frame: modal opening transforms can move
          // between two separate browser calls without changing row alignment.
          const offset = await input.evaluate((node) => {
            const year = node
              .closest(".collections-builder-row")
              .querySelector(".collections-builder-year");
            return Math.abs(node.getBoundingClientRect().y - year.getBoundingClientRect().y);
          });
          expect(offset).toBeLessThan(2);
        }
        const screenshotPath = testInfo.outputPath(`mintage-${width}-${theme}.png`);
        await builder(page).screenshot({ path: screenshotPath, animations: "disabled" });
        await testInfo.attach(`mintage-${width}-${theme}`, {
          path: screenshotPath,
          contentType: "image/png",
        });
      }
    }
  });
});

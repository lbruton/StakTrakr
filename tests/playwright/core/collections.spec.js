// Collections module (STRK-368, epic STRK-254) — new product domain: Collections.
//
// A Collection is a checklist over the inventory: each Slot links to Item UUIDs held on
// the Collection, never on the Item. These specs drive the real app (real Add Item modal,
// real delete funnel, real storage cleanup) rather than re-proving the pure rules already
// pinned by tests/unit/collections-core.test.js.

import { test, expect } from "../helpers/mocks/extended-test.js";

/**
 * Build one inventory fixture for the collection tests.
 * @param {string} uuid - Stable item identifier.
 * @param {string} name - Display name.
 * @param {string} year - Mint year.
 * @param {number} serial - Inventory serial number.
 * @returns {object} Inventory item fixture.
 */
const baseItem = (uuid, name, year, serial) => ({
  uuid,
  metal: "Silver",
  composition: "Silver",
  name,
  qty: 1,
  type: "Coin",
  weight: 1,
  weightUnit: "oz",
  price: 30,
  marketValue: 0,
  date: "2026-01-01",
  purchaseLocation: "staktrakr.com",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year,
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
  serial,
});

const SEED = [
  baseItem("col-ase-2022-a", "2022 American Silver Eagle", "2022", 1),
  baseItem("col-ase-2022-b", "ASE 2022 (tube spare)", "2022", 2),
  baseItem("col-ase-2024", "2024 American Silver Eagle BU", "2024", 3),
  baseItem("col-maple-2024", "2024 Canadian Silver Maple Leaf", "2024", 4),
];

/**
 * Seeds inventory once (never on reload, so app-written state survives) and boots the
 * Inventory tab, where #newItemBtn lives.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {Array<object>} [items=SEED] - Inventory to seed before app scripts run.
 * @returns {Promise<void>} When the app and collection store are ready.
 */
const seedAndGoto = async (page, items = SEED) => {
  await page.addInitScript((items) => {
    if (!localStorage.getItem("metalInventory")) {
      localStorage.setItem("metalInventory", JSON.stringify(items));
    }
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
      },
      { once: true }
    );
  }, items);
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.appListenersReady === true && !!window.collectionsStore);
};

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

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.appListenersReady === true && !!window.collectionsStore
    );

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
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
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
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
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

/**
 * Wait for the boot signal the Collections UI renders on.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<import('@playwright/test').JSHandle>} Boot readiness result.
 */
const waitForApp = (page) =>
  page.waitForFunction(() => window.appListenersReady === true && !!window.collectionsUI);

/**
 * Switch to the Collections tab through the desktop header nav.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>} When the panel is visible.
 */
const openCollectionsTab = async (page) => {
  await waitForApp(page);
  await page.locator("#tabBtnCollections").click();
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
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
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
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
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
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForApp(page);
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
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.appListenersReady === true && !!window.collectionsStore
    );
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
    // Only real Series Templates ship — the mockup's Type 1 / Morgan demo entries must not.
    await expect(panel(page).locator("[data-collection-id]")).toHaveCount(1);
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

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
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

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForApp(page);
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

  test("with the COLLECTIONS flag off only the placeholder renders", async ({ page }) => {
    await seedAndGoto(page);
    // FeatureFlags reads the lower-cased flag name from the query string.
    await page.goto("/index.html?collections=false#/collections", {
      waitUntil: "domcontentloaded",
    });
    await waitForApp(page);

    await expect(panel(page)).toContainText("Prebuilt date runs and custom checklists");
    await expect(panel(page).locator("[data-collection-id]")).toHaveCount(0);
    await expect(panel(page).locator("[data-slot-id]")).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "Ledger view" })).toHaveCount(0);
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
    await expect(panel(page).locator(".collections-hubrow[data-collection-id]")).toBeVisible();
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

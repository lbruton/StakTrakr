// Collections module (STRK-368, epic STRK-254) — new product domain: Collections.
//
// A Collection is a checklist over the inventory: each Slot links to Item UUIDs held on
// the Collection, never on the Item. These specs drive the real app (real Add Item modal,
// real delete funnel, real storage cleanup) rather than re-proving the pure rules already
// pinned by tests/unit/collections-core.test.js.

import { test, expect } from "../helpers/mocks/extended-test.js";

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
 */
const seedAndGoto = async (page) => {
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
  }, SEED);
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.appListenersReady === true && !!window.collectionsStore);
};

/** Reads one slot of the ASE Type 2 collection as plain JSON (null when never touched). */
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
    const readProgress = () =>
      page.evaluate(() => {
        const store = window.collectionsStore;
        return store.progress(store.getState().collections["ase-type2"]).owned;
      });
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2024", "col-ase-2024"));
    expect(await readProgress()).toBe(1);

    await page.evaluate(() => {
      const item = window.inventory.find((entry) => entry.uuid === "col-ase-2024");
      item.disposition = { type: "sold", date: "2026-09-01", amount: 70, currency: "USD" };
    });
    expect(await readProgress()).toBe(0);
    // Disposal never rewrites the stored link — that is what lets an undo restore the slot.
    expect(await readSlot(page, "2024")).toEqual({ primary: "col-ase-2024", spares: [] });

    await page.evaluate(() => {
      window.inventory.find((entry) => entry.uuid === "col-ase-2024").disposition = null;
    });
    expect(await readProgress()).toBe(1);
  });
});

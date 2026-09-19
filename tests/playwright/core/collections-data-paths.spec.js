// Collections data paths (STRK-371 / STRK-370, epic STRK-254).
//
// Collection membership lives on the Collection, never on the Item, so NO item-shaped data
// path carries it for free. This file pins every way a user's Collections leave and re-enter
// the app: the encrypted .stvault, the standalone Collections file, JSON, and CSV. The ZIP
// backup round trip stays in collections.spec.js where it landed with STRK-368.

import { test, expect } from "../helpers/mocks/extended-test.js";

/**
 * Build one inventory fixture.
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
  notes: "",
  year,
  purity: 0.999,
  serial,
});

const SEED = [
  baseItem("cdp-ase-2022", "2022 American Silver Eagle", "2022", 1),
  baseItem("cdp-ase-2024", "2024 American Silver Eagle BU", "2024", 2),
];

/**
 * Seeds inventory once (never on reload, so app-written state survives) and boots the app.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @returns {Promise<void>} When the app and the collection store are ready.
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

/**
 * Read one ASE Type 2 slot's primary from the in-memory store.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {string} slotId - Slot identifier.
 * @returns {Promise<string|null>} Primary Item UUID, or null.
 */
const primaryOf = (page, slotId) =>
  page.evaluate((id) => {
    const collection = window.collectionsStore.getState().collections["ase-type2"];
    const link = collection && collection.slots[id];
    return link ? link.primary : null;
  }, slotId);

test.describe("core/collections-data-paths — encrypted vault", () => {
  test("a vault restore refreshes the in-memory store, so the next edit cannot erase the restored Collections", async ({
    page,
  }) => {
    await seedAndGoto(page);
    await page.waitForFunction(
      () =>
        typeof window.collectVaultData === "function" &&
        typeof window.restoreVaultData === "function"
    );

    // Back up with 2024 filled, then lose the link locally.
    const restored = await page.evaluate(async () => {
      window.collectionsStore.link("ase-type2", "2024", "cdp-ase-2024");
      const payload = window.collectVaultData("full");
      window.collectionsStore.unlink("ase-type2", "2024", "cdp-ase-2024");
      await window.restoreVaultData(payload);
      return Object.prototype.hasOwnProperty.call(payload.data, "collectionState");
    });
    expect(restored).toBe(true);

    // The restored link is visible to the running app without a reload...
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");

    // ...and a later mutation saves ON TOP of the restored state, not over it.
    await page.evaluate(() => window.collectionsStore.link("ase-type2", "2022", "cdp-ase-2022"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => window.appListenersReady === true && !!window.collectionsStore
    );
    expect(await primaryOf(page, "2024")).toBe("cdp-ase-2024");
    expect(await primaryOf(page, "2022")).toBe("cdp-ase-2022");
  });
});

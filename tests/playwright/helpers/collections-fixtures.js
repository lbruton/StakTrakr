/** Shared inventory fixture for the Collections browser suites. */
export const collectionItem = (uuid, name, year, serial) => ({
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

/** Boot a page with inventory seeded only on its first visit. */
export const seedCollectionsPage = async (page, items) => {
  await page.addInitScript((seed) => {
    if (!localStorage.getItem("metalInventory")) {
      localStorage.setItem("metalInventory", JSON.stringify(seed));
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

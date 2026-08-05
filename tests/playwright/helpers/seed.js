export async function injectSeedInventory(page) {
  const seed = (await import("../../fixtures/seed-inventory.js")).default;
  await page.addInitScript((data) => {
    Object.entries(data).forEach(([k, v]) => {
      localStorage.setItem(k, JSON.stringify(v));
    });
  }, seed);

  await suppressWhatsNewPopup(page);
}

/**
 * Suppresses the What's New popup: sets ackVersion = APP_VERSION at runtime.
 * The DOMContentLoaded listener is registered before versionCheck.js loads,
 * so it fires before checkVersionChange() reads the key. Exported for specs
 * that seed their own data but still need the popup out of the way.
 * @param {import('@playwright/test').Page} page - Page under test
 * @returns {Promise<void>}
 */
export async function suppressWhatsNewPopup(page) {
  await page.addInitScript(() => {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (typeof APP_VERSION !== "undefined") {
          localStorage.setItem("ackVersion", APP_VERSION);
        }
      },
      { once: true }
    );
  });
}

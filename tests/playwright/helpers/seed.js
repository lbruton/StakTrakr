export async function injectSeedInventory(page) {
  const seed = (await import("../../fixtures/seed-inventory.js")).default;
  await page.addInitScript((data) => {
    Object.entries(data).forEach(([k, v]) => {
      localStorage.setItem(k, JSON.stringify(v));
    });
  }, seed);

  // Suppress What's New popup: set ackVersion = APP_VERSION at runtime.
  // This DOMContentLoaded listener is registered before versionCheck.js loads,
  // so it fires before checkVersionChange() reads the key.
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

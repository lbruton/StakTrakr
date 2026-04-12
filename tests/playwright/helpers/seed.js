export async function injectSeedInventory(page) {
  const seed = (await import('../../fixtures/seed-inventory.js')).default;
  await page.addInitScript((data) => {
    Object.entries(data).forEach(([k, v]) => {
      localStorage.setItem(k, JSON.stringify(v));
    });
  }, seed);
}

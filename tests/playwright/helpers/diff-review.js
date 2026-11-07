/**
 * Opens the diff review modal on a sync diff: one unchanged, one changed (name, qty and
 * price) and one added Item. `extra` merges into the DiffModal.show options, for example a
 * settingsDiff or the backup and local counts.
 * @param {import('@playwright/test').Page} page - Playwright page with the app loaded.
 * @param {object} [extra] - Additional DiffModal.show options.
 * @returns {Promise<void>}
 */
export async function showSampleDiffReview(page, extra = {}) {
  await page.evaluate((extraOptions) => {
    const base = {
      metal: "Silver",
      type: "Coin",
      weight: 1,
      price: 30,
      purchaseDate: "2026-01-02",
    };
    const local = [
      { ...base, uuid: "dm-kept", name: "Kept Eagle", qty: 1 },
      { ...base, uuid: "dm-changed", name: "Old Maple", qty: 2 },
    ];
    const remote = [
      { ...base, uuid: "dm-changed", name: "New Maple", qty: 5, price: 32 },
      { ...base, uuid: "dm-added", name: "Added Britannia", qty: 3 },
    ];
    window.DiffModal.show({
      source: { type: "sync", label: "Dropbox" },
      diff: window.DiffEngine.compareItems(local, remote),
      onApply: () => {},
      onCancel: () => {},
      ...extraOptions,
    });
  }, extra);
}

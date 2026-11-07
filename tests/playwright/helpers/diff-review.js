/**
 * Opens the diff review modal on a sync diff: one deleted, one modified (name, qty and
 * price) and one added Item. `extra` merges into the DiffModal.show options, for example a
 * settingsDiff or the backup and local counts. It crosses into the page as JSON, so it
 * cannot carry callbacks; onApply and onCancel stay no-ops.
 * @param {import('@playwright/test').Page} page - Playwright page with the app loaded.
 * @param {object} [extra] - Additional serializable DiffModal.show options.
 * @param {string} [nameSuffix] - Text appended to every Item name, for long-name layouts.
 * @returns {Promise<void>}
 */
export async function showSampleDiffReview(page, extra = {}, nameSuffix = "") {
  await page.evaluate(
    ([extraOptions, suffix]) => {
      const base = {
        metal: "Silver",
        type: "Coin",
        weight: 1,
        price: 30,
        purchaseDate: "2026-01-02",
      };
      const local = [
        { ...base, uuid: "dm-kept", name: `Kept Eagle${suffix}`, qty: 1 },
        { ...base, uuid: "dm-changed", name: `Old Maple${suffix}`, qty: 2 },
      ];
      const remote = [
        { ...base, uuid: "dm-changed", name: `New Maple${suffix}`, qty: 5, price: 32 },
        { ...base, uuid: "dm-added", name: `Added Britannia${suffix}`, qty: 3 },
      ];
      window.DiffModal.show({
        source: { type: "sync", label: "Dropbox" },
        diff: window.DiffEngine.compareItems(local, remote),
        onApply: () => {},
        onCancel: () => {},
        ...extraOptions,
      });
    },
    [extra, nameSuffix]
  );
}

// STRK-186 — Restore flows must rehydrate CatalogConfig from localStorage.
// The CatalogConfig singleton reads catalog_api_config once in its constructor;
// before the fix, restore paths wrote the key to localStorage but left the
// stale in-memory defaults in place, and the next CatalogConfig.save() (e.g.
// a usage-counter increment) permanently clobbered the freshly-restored key.
import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

// Test fixtures, not real credentials.
const VAULT_PASSWORD = "strk186-vault-pass"; // gitleaks:allow
const NUMISTA_KEY = "strk186-numista-api-key"; // gitleaks:allow

/**
 * Seed the Numista key through the real setter (writes localStorage AND
 * in-memory config), then export an encrypted vault. Returns vault bytes.
 *
 * Deliberately NOT seeded via addInitScript — init scripts re-run on every
 * navigation and would re-seed the key after the storage wipe, masking the
 * exact bug this spec guards against.
 */
async function seedKeyAndExport(page) {
  await injectSeedInventory(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.vaultEncryptToBytes === "function" &&
      typeof window.catalogConfig !== "undefined"
  );
  return page.evaluate(
    async ({ password, key }) => {
      window.catalogConfig.setNumistaConfig(key);
      const bytes = await window.vaultEncryptToBytes(password);
      return Array.from(bytes);
    },
    { password: VAULT_PASSWORD, key: NUMISTA_KEY }
  );
}

/**
 * Wipe localStorage from a neutral same-origin page (the app is not running
 * there), then boot the app fresh so CatalogConfig constructs from empty
 * defaults — the state of the original beta report.
 */
async function wipeAndReboot(page) {
  await page.goto("/strk186-neutral-404", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.catalogConfig !== "undefined");
}

/** Decode the Numista key currently persisted in localStorage (base64). */
function readPersistedKey(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("catalog_api_config");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const stored = parsed?.numista?.apiKey || "";
    try {
      return atob(stored);
    } catch (e) {
      return stored;
    }
  });
}

test.describe("STRK-186 catalog key vault restore", () => {
  test("full restore rehydrates CatalogConfig and key survives usage-counter save + reload", async ({
    page,
  }) => {
    const vaultBytes = await seedKeyAndExport(page);
    await wipeAndReboot(page);

    // Sanity: the wipe really removed the key from the booted singleton.
    const wipedKey = await page.evaluate(() => window.catalogConfig.config.numista.apiKey);
    expect(wipedKey).toBe("");

    // Restore through the funnel path (legacy full restore — also the code
    // path used by the diff-preview fallback and cloud-sync pull).
    const inMemoryKey = await page.evaluate(
      async ({ password, bytes }) => {
        window.showToast = () => {};
        await window.vaultDecryptAndRestore(new Uint8Array(bytes), password);
        return window.catalogConfig.config.numista.apiKey;
      },
      { password: VAULT_PASSWORD, bytes: vaultBytes }
    );
    expect(inMemoryKey).toBe(NUMISTA_KEY);

    // Trigger the clobber: a usage-counter save serializes in-memory config
    // back to localStorage. Before the fix this overwrote the restored key.
    await page.evaluate(() => window.catalogConfig.incrementNumistaUsage());
    expect(await readPersistedKey(page)).toBe(NUMISTA_KEY);

    // Reload — the singleton re-reads localStorage; key must still be there.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.catalogConfig !== "undefined");
    expect(await readPersistedKey(page)).toBe(NUMISTA_KEY);
    expect(await page.evaluate(() => window.catalogConfig.config.numista.apiKey)).toBe(NUMISTA_KEY);
  });

  test("diff-preview apply rehydrates CatalogConfig and key survives usage-counter save", async ({
    page,
  }) => {
    const vaultBytes = await seedKeyAndExport(page);
    await wipeAndReboot(page);
    await page.waitForFunction(
      () =>
        typeof window.vaultRestoreWithPreview === "function" &&
        typeof window.DiffModal !== "undefined"
    );

    // Restore via the diff-preview path, auto-applying settings changes
    // (settings are all-or-nothing; an empty selection still applies them).
    const result = await page.evaluate(
      async ({ password, bytes }) => {
        let applied = false;
        const origShow = window.DiffModal.show;
        window.showToast = () => {};
        window.DiffModal.show = (opts) => {
          applied = true;
          opts.onApply([]);
        };
        await window.vaultRestoreWithPreview(new Uint8Array(bytes), password);
        window.DiffModal.show = origShow;
        return {
          applied,
          inMemoryKey: window.catalogConfig.config.numista.apiKey,
        };
      },
      { password: VAULT_PASSWORD, bytes: vaultBytes }
    );
    expect(result.applied).toBe(true);
    expect(result.inMemoryKey).toBe(NUMISTA_KEY);

    await page.evaluate(() => window.catalogConfig.incrementNumistaUsage());
    expect(await readPersistedKey(page)).toBe(NUMISTA_KEY);
  });
});

/**
 * Shared cloud-sync vault fixtures for Playwright specs.
 *
 * Extracted from the duplicated per-spec helpers in attachments-cloud.spec.js
 * (`encryptVaultPayload`) and item-price-history-cloud.spec.js
 * (`encryptVaultFile`), which Codacy flagged as a clone on STRK-225 (#1306).
 */

/**
 * Encrypts an arbitrary object as a StakTrakr `.stvault` file
 * (`salt|iv|iter|ciphertext`) under the composite sync key, runnable in-page so
 * it uses the app's exact crypto chain (`vaultRandomBytes` / `vaultDeriveKey` /
 * `vaultEncrypt` / `serializeVaultFile`). The PBKDF2 iteration count is resolved
 * in-page from `window.VAULT_PBKDF2_ITERATIONS` (falling back to 600000) so the
 * fixture stays in lockstep with the app's parameters.
 *
 * Used to serve decryptable remote vaults to the in-app decrypt paths — e.g. the
 * STRK-225 vault-first main sync vault (`{ data: { metalInventory } }`) and image
 * companion vault (`{ records, patternRecords }`), and the STRK-147 sync-metadata
 * and item-price-history companion vaults.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} payload - the object to encrypt as the vault body
 * @param {string} syncKey - the composite `password:accountId` sync key
 * @returns {Promise<number[]>} the serialized vault file bytes
 */
export async function encryptVaultPayload(page, payload, syncKey) {
  return page.evaluate(
    async ({ data, key }) => {
      const iterations =
        typeof window.VAULT_PBKDF2_ITERATIONS !== "undefined"
          ? window.VAULT_PBKDF2_ITERATIONS
          : 600000;
      const salt = window.vaultRandomBytes(32);
      const iv = window.vaultRandomBytes(12);
      const derived = await window.vaultDeriveKey(key, salt, iterations);
      const plaintext = new TextEncoder().encode(JSON.stringify(data));
      const ciphertext = await window.vaultEncrypt(plaintext, derived, iv);
      return Array.from(
        new Uint8Array(window.serializeVaultFile(salt, iv, iterations, ciphertext))
      );
    },
    { data: payload, key: syncKey }
  );
}

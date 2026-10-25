// Slices of js/cloud-sync.js that several unit suites evaluate with injected doubles.

import { evalSource, readSource, sliceUntil } from "./source-extract.js";

export const SYNC_FILE = "js/cloud-sync.js";

/**
 * Hex-encodes a SHA-256 digest (mirrors the cloud-sync helper).
 * @param {ArrayBuffer} buffer - Digest bytes.
 * @returns {string} Lowercase hex.
 */
export function sha256BufferToHex(buffer) {
  const a = new Uint8Array(buffer);
  let hex = "";
  for (let j = 0; j < a.length; j++) hex += ("0" + a[j].toString(16)).slice(-2);
  return hex;
}

/**
 * Evaluates the empty-diff "silently record pull" branch of the pull flow as an
 * async runner. `_previewPullMeta` stays a free identifier, so it resolves on
 * globalThis (the body runs non-strict) and a test can change it mid-await.
 * @param {Record<string, unknown>} params - The branch's free names; the two
 *   `_no*Changes` flags default to true so the branch runs.
 * @returns {() => Promise<void>}
 */
export function loadSilentPullBranch(params) {
  return evalSource(SYNC_FILE, {
    params: { _noItemChanges: true, _noSettingsChanges: true, ...params },
    slice: sliceUntil(
      readSource(SYNC_FILE),
      "if (_noItemChanges && _noSettingsChanges) {",
      "// STRK-224 (Edge 3, D-3): capture the FULL prior lastPull"
    ),
    opener: "return (async function () {",
    suffix: "\n});",
  });
}

/**
 * Evaluates the real `_stableCanonicalString`, which other slices take as an injected dependency.
 * @returns {Function}
 */
export function loadStableCanonicalString() {
  return evalSource(SYNC_FILE, {
    slice: sliceUntil(
      readSource(SYNC_FILE),
      "function _stableCanonicalString",
      "function _canonicalizeSettingValue"
    ),
    suffix: "\nreturn _stableCanonicalString;",
  });
}

/**
 * Evaluates the settings-hash block (from `_stableCanonicalString` up to
 * `initSyncTabCoordination`) over a localStorage double.
 * @param {object} options
 * @param {Record<string, string>} options.store - Raw localStorage values by key.
 * @param {string[]} options.scope - SYNC_SCOPE_KEYS.
 * @param {Function} options.decompress - __decompressIfNeeded.
 * @param {string[]} options.returns - Names the block returns as one object.
 * @returns {Record<string, Function>}
 */
export function loadSettingsHashBlock({ store, scope, decompress, returns }) {
  const slice = sliceUntil(
    readSource(SYNC_FILE),
    "function _stableCanonicalString",
    "function initSyncTabCoordination"
  );
  return evalSource(SYNC_FILE, {
    params: {
      crypto: globalThis.crypto,
      localStorage: { getItem: (k) => (k in store ? store[k] : null) },
      SYNC_SCOPE_KEYS: scope,
      __decompressIfNeeded: decompress,
      TextEncoder,
      sha256BufferToHex,
      debugLog: () => {},
    },
    slice,
    suffix: `\nreturn { ${returns.join(", ")} };`,
  });
}

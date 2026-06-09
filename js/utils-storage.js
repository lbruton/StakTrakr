// UTILS · STORAGE (STRK-177)
// =============================================================================
// localStorage persistence + compression, extracted verbatim from js/utils.js to
// keep each file under the Codacy Lizard file-nloc gate (1500). Pure code motion —
// no behavior change. Holds: the vendored-LZString bind (__LZ), save/load(+Sync)
// helpers, __wouldClobberCompressed, cleanupStorage, the CMP2 compression codec
// (__compressIfNeeded/__decompressIfNeeded), and the one-time CMP1->CMP2 boot
// migration (__migrateCompressionV2).
//
// Bare global declarations (no IIFE) — other modules keep calling these as globals
// with no call-site change. All call sites run at runtime, so load order alone
// suffices; this file loads before js/utils.js in index.html.
// =============================================================================

// Real LZString engine is vendored at vendor/lz-string.min.js and loaded before this
// file in index.html (defer preserves document order). Bind it under a module-private
// name (__LZ) — NOT `const LZString` — because the vendored script declares a global
// `var LZString`, and a top-level `const LZString` here would collide ("Identifier
// already declared") and abort the entire file. Fall back to an identity no-op so a
// missing vendor file degrades to "no compression" rather than corrupting data. (STRK-140)
const __LZ_REAL = (() => {
  try {
    const lz = (typeof window !== "undefined" && window.LZString) || null;
    if (
      !lz ||
      typeof lz.compressToUTF16 !== "function" ||
      typeof lz.decompressFromUTF16 !== "function"
    ) {
      return false;
    }
    // Sentinel round-trip that ALSO proves real compression occurred. An identity-shaped
    // global (compressToUTF16 = passthrough) would round-trip but not transform, and must
    // be rejected — otherwise we'd emit CMP2 over an uncompressed body. (STRK-140)
    const probe = "STRK-140-".repeat(8);
    const comp = lz.compressToUTF16(probe);
    return comp !== probe && lz.decompressFromUTF16(comp) === probe;
  } catch (e) {
    return false;
  }
})();
const __LZ = __LZ_REAL
  ? window.LZString
  : { compressToUTF16: (input) => input, decompressFromUTF16: (input) => input };

// UTILITY FUNCTIONS

/**
 * Escape HTML special characters to prevent XSS when interpolating into innerHTML.
 * @param {*} str - Value to escape (coerced to string)
 * @returns {string} Escaped HTML-safe string
 */
/**
 * Save data to localStorage with optional compression
 * @param {string} key - Storage key
 * @param {any} data - Data to store
 * @param {{quietQuotaToast?: boolean}} [options] - Optional save behavior flags
 */
// Fail-closed guard (STRK-140): when no real compression engine is available, refuse to
// overwrite a key whose existing on-disk value is real-compressed (CMP2). We cannot read
// it, so writing default/empty data would permanently clobber recoverable user data. The
// on-disk CMP2 value is preserved and becomes readable again once the engine loads.
const __wouldClobberCompressed = (key) => {
  if (__LZ_REAL) return false;
  try {
    const existing = localStorage.getItem(key);
    return typeof existing === "string" && existing.startsWith(__ST_COMP_PREFIX);
  } catch (e) {
    return false;
  }
};

const saveData = async (key, data, options = {}) => {
  try {
    if (__wouldClobberCompressed(key)) {
      console.warn(
        `saveData skipped for ${key}: compression engine unavailable, refusing to overwrite compressed data`
      );
      return;
    }
    const raw = JSON.stringify(data);
    const out = __compressIfNeeded(raw);
    localStorage.setItem(key, out);
    // STAK-414: Track when inventory was last modified locally so the sync
    // poller can detect that local data is newer than the remote vault and
    // trigger a push instead of a pull.
    if (key === "metalInventory") {
      localStorage.setItem("cloud_sync_local_modified", new Date().toISOString());
    }
  } catch (e) {
    console.error("saveData failed", e);
    // STAK-421: Surface QuotaExceededError unless the caller marked the write as optional.
    if (
      e &&
      e.name === "QuotaExceededError" &&
      !options.quietQuotaToast &&
      typeof showToast === "function"
    ) {
      showToast(
        "Storage is full — some data could not be saved. Try clearing unused spot history or image cache.",
        "error"
      );
    }
  }
};

/**
 * Load data from localStorage with optional decompression
 * @param {string} key - Storage key
 * @param {any} [defaultValue=[]] - Default value if no data found
 * @returns {any} Parsed data or default value
 */
const loadData = async (key, defaultValue = []) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaultValue;
    const str = __decompressIfNeeded(raw);
    return JSON.parse(str);
  } catch (e) {
    console.warn(`loadData failed for ${key}, returning default:`, e);
    return defaultValue;
  }
};

// Synchronous versions for backward compatibility where async isn't supported
const saveDataSync = (key, data, options = {}) => {
  try {
    if (__wouldClobberCompressed(key)) {
      console.warn(
        `saveDataSync skipped for ${key}: compression engine unavailable, refusing to overwrite compressed data`
      );
      return;
    }
    const raw = JSON.stringify(data);
    const out = __compressIfNeeded(raw);
    localStorage.setItem(key, out);
  } catch (e) {
    console.error("saveDataSync failed", e);
    if (
      e &&
      e.name === "QuotaExceededError" &&
      !options.quietQuotaToast &&
      typeof showToast === "function"
    ) {
      showToast(
        "Storage is full — some data could not be saved. Try clearing unused spot history or image cache.",
        "error"
      );
    }
    throw e;
  }
};
const loadDataSync = (key, defaultValue = []) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaultValue;
    const str = __decompressIfNeeded(raw);
    return JSON.parse(str);
  } catch (e) {
    return defaultValue;
  }
};

/**
 * Removes unknown localStorage keys to maintain a clean storage state
 *
 * Iterates over all localStorage entries and deletes any keys not present in
 * ALLOWED_STORAGE_KEYS.
 */
const cleanupStorage = () => {
  if (typeof localStorage === "undefined") return;
  const allowed = new Set(ALLOWED_STORAGE_KEYS);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!allowed.has(key)) {
      localStorage.removeItem(key);
    }
  }
};

/**
 * One-time migration (STRK-140): re-encode legacy CMP1 localStorage values into the real
 * CMP2 (lz-string) format for immediate quota relief across ALL users — not just those
 * whose caches happen to rewrite soon.
 *
 * Targets ONLY legacy CMP1: entries (prefix + UNCOMPRESSED body, written via the storage
 * wrappers while LZString was a no-op). These are guaranteed to be read back through
 * loadData/loadDataSync, so re-encoding to CMP2 is transparent. Raw/unprefixed values are
 * deliberately left untouched — they may have been written outside the compression pipeline
 * and could have raw readers; compressing them would risk corruption.
 *
 * Operates on RAW strings (no JSON round-trip) so the body is preserved byte-for-byte, and
 * uses raw setItem (NOT saveData) so it never touches cloud_sync_local_modified / sync.
 * Idempotent via a one-time flag; no-op without a real engine; best-effort (never blocks boot).
 */
const __migrateCompressionV2 = () => {
  if (typeof localStorage === "undefined" || !__LZ_REAL) return;
  try {
    if (localStorage.getItem("migration_cmp2_compression") === "true") return;
  } catch (e) {
    return;
  }
  let allRewritesOk = true;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    for (const key of keys) {
      if (key === "migration_cmp2_compression") continue;
      let raw;
      try {
        raw = localStorage.getItem(key);
      } catch (e) {
        continue;
      }
      if (typeof raw !== "string") continue;
      // Only convert legacy CMP1 entries (wrapper-written identity-stub output).
      if (!raw.startsWith(__ST_LEGACY_PREFIX)) continue;
      const original = raw.slice(__ST_LEGACY_PREFIX.length); // legacy uncompressed body
      const recompressed = __compressIfNeeded(original);
      if (recompressed !== raw) {
        try {
          localStorage.setItem(key, recompressed);
        } catch (e) {
          // A shrinking rewrite should fit; if it somehow fails (e.g. quota), leave the
          // original intact and DON'T mark the migration done — retry on the next boot.
          allRewritesOk = false;
        }
      }
    }
  } catch (e) {
    // best-effort — never block boot
    allRewritesOk = false;
  }
  // Only set the one-time flag when every rewrite succeeded; a transient failure must not
  // lock a user into a partially-migrated state — retry on the next boot instead. (Copilot)
  if (!allRewritesOk) return;
  try {
    localStorage.setItem("migration_cmp2_compression", "true");
  } catch (e) {
    /* ignore */
  }
};

/**
 * Storage compression helpers.
 * CMP2: = real lz-string (compressToUTF16), introduced in v3.35.1 (STRK-140).
 * CMP1: = legacy identity-stub format — prefix + UNCOMPRESSED body (v3.34.85..3.35.0,
 *         when LZString was a no-op). Its body must be sliced, NOT decompressed:
 *         lz-string decompressFromUTF16 on never-compressed text returns garbage.
 */
const __ST_COMP_PREFIX = "CMP2:";
const __ST_LEGACY_PREFIX = "CMP1:";
function __compressIfNeeded(str) {
  try {
    if (!str || str.length < 4096) return str;
    // Only emit the CMP2 marker when a REAL engine is present. If lz-string failed to
    // load (__LZ is the identity fallback), store plain/unprefixed so a later read with a
    // working engine never tries to decompress never-compressed data → corruption. (STRK-140)
    if (!__LZ_REAL) return str;
    return __ST_COMP_PREFIX + __LZ.compressToUTF16(str);
  } catch (e) {
    return str;
  }
}
function __decompressIfNeeded(stored) {
  try {
    if (typeof stored !== "string") return stored;
    if (stored.startsWith(__ST_COMP_PREFIX)) {
      return __LZ.decompressFromUTF16(stored.slice(__ST_COMP_PREFIX.length));
    }
    if (stored.startsWith(__ST_LEGACY_PREFIX)) {
      return stored.slice(__ST_LEGACY_PREFIX.length);
    }
    return stored;
  } catch (e) {
    return stored;
  }
}
// Kick off the one-time CMP1->CMP2 migration. Registered at end-of-file so every helper it
// depends on (__compressIfNeeded, the prefixes) is already defined. Guard on readyState so
// it fires whether utils.js loads before DOMContentLoaded (normal defer) OR after the DOM is
// already parsed (dynamic/late load — DOMContentLoaded would never fire again). (Gemini)
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", __migrateCompressionV2);
  } else {
    __migrateCompressionV2();
  }
}

// =============================================================================
// Public surface (moved verbatim from js/utils.js with the functions). STAK-222.
if (typeof window !== "undefined") {
  window.cleanupStorage = cleanupStorage;
  window.saveDataSync = saveDataSync;
  window.loadDataSync = loadDataSync;
}

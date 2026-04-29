/**
 * @fileoverview Boot diagnostics ring buffer for the seed-guard pipeline (STRK-13).
 *
 * Records lightweight, privacy-safe boot events so we can diagnose first-run
 * failures (parse errors, missing seeds, quota issues) without inspecting the
 * user's inventory contents. The ring buffer is capped at 10 entries —
 * newest-first — and persisted to localStorage under
 * `staktrakr.bootDiagnostics`.
 *
 * Persisted entry shape:
 *   {
 *     ts: ISO string,
 *     version: APP_VERSION,
 *     classification: string,
 *     keyPresence: { [key]: boolean },
 *     errorName?: string   // JS error class name only — never the message
 *   }
 *
 * Privacy contract: callers MUST pass booleans for `keyPresence` values and
 * the JS error class name (e.g. "SyntaxError") for `errorName`. No inventory
 * contents, serials, prices, tokens, or user-identifying data.
 *
 * Both functions are exposed on `window` so init.js, error handlers, and
 * console debugging can reach them. All globals (`APP_VERSION`, `debugLog`,
 * `loadDataSync`, `saveDataSync`) are looked up at call time, not at parse
 * time, so script load order does not matter.
 */

(function (global) {
  "use strict";

  var STORAGE_KEY = "staktrakr.bootDiagnostics";
  var MAX_ENTRIES = 10;

  /**
   * Record a single boot diagnostic event.
   *
   * Failures (storage quota, disabled storage, JSON errors) are swallowed —
   * boot diagnostics must never break boot. Errors are logged via debugLog
   * when available.
   *
   * @param {Object} entry
   * @param {string} entry.classification - short event label (e.g. "first-run-empty", "parse-error")
   * @param {Object} entry.keyPresence - map of localStorage key name to boolean
   * @param {string} [entry.errorName] - JS error class name (optional)
   */
  function recordBootDiagnostic(entry) {
    try {
      if (!entry || typeof entry !== "object") return;

      var version = typeof APP_VERSION === "string" ? APP_VERSION : "unknown";

      var record = {
        ts: new Date().toISOString(),
        version: version,
        classification: entry.classification,
        keyPresence: entry.keyPresence,
      };

      if (entry.errorName) {
        record.errorName = entry.errorName;
      }

      var existing = [];
      if (typeof loadDataSync === "function") {
        existing = loadDataSync(STORAGE_KEY, []);
      }
      if (!Array.isArray(existing)) existing = [];

      existing.unshift(record);
      existing = existing.slice(0, MAX_ENTRIES);

      if (typeof saveDataSync === "function") {
        saveDataSync(STORAGE_KEY, existing, { quietQuotaToast: true });
      }
    } catch (err) {
      try {
        if (typeof debugLog === "function") {
          debugLog("recordBootDiagnostic failed:", err && err.name);
        }
      } catch (_) {
        /* swallow — must not propagate */
      }
    }
  }

  /**
   * Retrieve the current boot diagnostics ring buffer.
   *
   * @returns {Array<Object>} newest-first array of entries (empty on failure)
   */
  function getBootDiagnostics() {
    try {
      if (typeof loadDataSync !== "function") return [];
      var arr = loadDataSync(STORAGE_KEY, []);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  global.recordBootDiagnostic = recordBootDiagnostic;
  global.getBootDiagnostics = getBootDiagnostics;
})(typeof window !== "undefined" ? window : this);

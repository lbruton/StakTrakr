/**
 * @fileoverview Bootstrap for global debug logging helpers.
 * Creates `debugLog`, `debugWarn`, `debugError`, and `getDebugHistory` once.
 */

/* DEBUG LOG BOOTSTRAP */
(function (global) {
  "use strict";
  if (typeof global.debugLog === "function") return;
  const history = [];
  function isEnabled() {
    try {
      return !!(
        localStorage.getItem("staktrakr.debug") || localStorage.getItem("stackrtrackr.debug")
      );
    } catch (_) {
      return true;
    }
  }
  function log(level, args) {
    if (!isEnabled()) return;
    try {
      const parts = ["[StakTrakr]", new Date().toISOString(), level + ":"].concat(
        [].slice.call(args)
      );
      history.push(parts.join(" "));
      if (level === "WARN") console.warn.apply(console, parts);
      else if (level === "ERROR") console.error.apply(console, parts);
      else console.log.apply(console, parts);
    } catch (e) {}
  }
  /**
   * Logs an informational debug entry.
   * @global
   * @function debugLog
   * @param {...*} args
   * @returns {void}
   */
  global.debugLog = function () {
    log("INFO", arguments);
  };
  /**
   * Logs a warning debug entry.
   * @global
   * @function debugWarn
   * @param {...*} args
   * @returns {void}
   */
  global.debugWarn = function () {
    log("WARN", arguments);
  };
  /**
   * Logs an error debug entry.
   * @global
   * @function debugError
   * @param {...*} args
   * @returns {void}
   */
  global.debugError = function () {
    log("ERROR", arguments);
  };
  /**
   * Returns a copy of debug log history entries.
   * @global
   * @function getDebugHistory
   * @returns {Array.<string>}
   */
  global.getDebugHistory = function () {
    return history.slice();
  };
})(typeof window !== "undefined" ? window : this);

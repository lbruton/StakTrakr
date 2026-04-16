/**
 * @fileoverview Localhost-only test harness loader.
 * Injects browser test scripts during local development runs.
 */

// Test loader — injects test scripts when running on localhost
if (window.location.hostname === "localhost") {
  const testScript = document.createElement("script");
  testScript.defer = true;
  testScript.src = "./tests/grouped-name-chips.test.js";
  document.head.appendChild(testScript);
}

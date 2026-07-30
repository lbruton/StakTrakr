// Guard against top-level identifier collisions between js/ modules (STRK-315).
//
// StakTrakr has no bundler and no import graph — every js/ file is loaded as a
// plain <script defer> and shares ONE top-level scope. Two files declaring the
// same top-level name is therefore not isolated-per-module, it is a
// redeclaration:
//
//   - `const X` in file A + `var X`/`const X`/`let X` in file B
//     → "SyntaxError: Identifier 'X' has already been declared", which kills
//       whichever script parses second. The app boots with an entire module
//       silently missing.
//   - `function f` in both → silent overwrite; last one loaded wins.
//
// This bit during STRK-315: a `VOLATILE_SETTING_FIELDS` twin was added as
// `const` in diff-engine.js and `var` in cloud-sync.js. cloud-sync.js stopped
// parsing entirely, so `scheduleSyncPush` was never assigned and every cloud
// Playwright spec hung. The existing codebase already works around this by
// giving twins distinct names (_stableStringify in diff-engine.js vs
// _stableCanonicalString in cloud-sync.js); this test enforces that convention
// instead of relying on reviewers to spot it.
//
// Parse-only: node:vm's Script compiles source without executing it, so no
// browser globals are needed. Redeclaration errors are raised at compile
// time, which is exactly the failure mode being guarded. vm.Script is used
// instead of `new Function(src)` both because it is a truer model of how a
// <script> tag parses (Function wraps the body in an implicit function
// scope) and because static analysis flags `new Function()` as dynamic code
// execution — vm.Script triggers no such finding.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Collect the app's own js/ scripts in the order index.html loads them.
 * Vendor bundles are excluded — they are third-party and not our namespace.
 * Accepts both `src="./js/foo.js"` and the leading-`./`-free
 * `src="js/foo.js"` — index.html uses both conventions, and an earlier
 * version of this regex silently dropped js/debug-log.js by requiring `./`.
 * @returns {string[]} repo-relative script paths, in load order
 */
function appScriptsInLoadOrder() {
  const html = readFileSync(join(repoRoot, "index.html"), "utf-8");
  const re = /<script[^>]*src="(?:\.\/)?(js\/[^"]+\.js)"/g;
  const files = [];
  let m;
  while ((m = re.exec(html)) !== null) files.push(m[1]);
  return files;
}

/**
 * Independently count `<script src="js/...">` tags in index.html without
 * reusing appScriptsInLoadOrder()'s regex. This extracts every `<script
 * src="...">` value with a broad, unopinionated pattern, then normalizes and
 * filters in plain JS rather than folding that logic into the regex itself.
 * It exists purely as a cross-check: if appScriptsInLoadOrder()'s shape
 * assumption about the markup ever drifts again (as it did for
 * js/debug-log.js, which has no leading `./`), this independent count
 * disagrees with its length and the test below fails loudly instead of
 * silently under-counting.
 * @returns {number} count of script tags whose src points into js/
 */
function countAppScriptTagsIndependently() {
  const html = readFileSync(join(repoRoot, "index.html"), "utf-8");
  const re = /<script[^>]*\ssrc="([^"]+)"/g;
  let count = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1].replace(/^\.\//, "");
    if (src.startsWith("js/") && src.endsWith(".js")) count++;
  }
  return count;
}

describe("js/ modules share one global scope without colliding", () => {
  const files = appScriptsInLoadOrder();

  test("index.html script count matches an independently-derived count (guard against a silent regex miss)", () => {
    // If appScriptsInLoadOrder()'s regex changes shape and starts silently
    // dropping matches (as it once did for js/debug-log.js), the collision
    // test below would still pass — it just wouldn't be checking everything.
    // Cross-checking against a second, differently-derived count catches
    // that partial-miss failure mode, which a bare `files.length > N` lower
    // bound cannot.
    const independentCount = countAppScriptTagsIndependently();
    assert.equal(
      files.length,
      independentCount,
      `appScriptsInLoadOrder() found ${files.length} scripts but an independent ` +
        `count found ${independentCount} — the discovery regex is missing some ` +
        `<script src="js/..."> tags`
    );
    assert.ok(
      files.includes("js/debug-log.js"),
      "js/debug-log.js (no leading ./ in its src) must be covered by the collision guard"
    );
  });

  test("every index.html script parses together in one shared scope", () => {
    const combined = files
      .map((f) => `// ==== ${f} ====\n${readFileSync(join(repoRoot, f), "utf-8")}`)
      .join("\n;\n");
    assert.doesNotThrow(
      () => new vm.Script(combined),
      "a top-level const/let/var name is declared in two js/ files — rename one " +
        "(see _stableStringify vs _stableCanonicalString for the convention)"
    );
  });

  test("the STRK-315 pair specifically stays collision-free", () => {
    // diff-engine.js and cloud-sync.js each carry a deliberately duplicated
    // volatile-field strip (marked duplication-ok, since diff-engine is
    // dependency-free by design). Duplicated LOGIC is fine; duplicated NAMES
    // are not.
    const pair = ["js/diff-engine.js", "js/cloud-sync.js"]
      .map((f) => readFileSync(join(repoRoot, f), "utf-8"))
      .join("\n;\n");
    assert.doesNotThrow(() => new vm.Script(pair));
  });
});

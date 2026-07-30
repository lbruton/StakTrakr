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
// Parse-only: new Function(src) compiles without executing, so no browser
// globals are needed. Redeclaration errors are raised at compile time, which
// is exactly the failure mode being guarded.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Collect the app's own js/ scripts in the order index.html loads them.
 * Vendor bundles are excluded — they are third-party and not our namespace.
 * @returns {string[]} repo-relative script paths, in load order
 */
function appScriptsInLoadOrder() {
  const html = readFileSync(join(repoRoot, "index.html"), "utf-8");
  const re = /<script[^>]*src="\.\/(js\/[^"]+\.js)"/g;
  const files = [];
  let m;
  while ((m = re.exec(html)) !== null) files.push(m[1]);
  return files;
}

describe("js/ modules share one global scope without colliding", () => {
  const files = appScriptsInLoadOrder();

  test("index.html actually lists app scripts (guard against a silent regex miss)", () => {
    // If the markup changes shape and the regex stops matching, the collision
    // test below would vacuously pass on an empty string. Fail loudly instead.
    assert.ok(
      files.length > 50,
      `expected index.html to load many js/ scripts, found ${files.length}`
    );
  });

  test("every index.html script parses together in one shared scope", () => {
    const combined = files
      .map((f) => `// ==== ${f} ====\n${readFileSync(join(repoRoot, f), "utf-8")}`)
      .join("\n;\n");
    assert.doesNotThrow(
      () => new Function(combined),
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
    assert.doesNotThrow(() => new Function(pair));
  });
});

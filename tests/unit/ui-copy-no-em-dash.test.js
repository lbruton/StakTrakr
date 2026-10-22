// Toasts and alerts join clauses with a full stop or a colon, never an em-dash
// (.context/voice.md, UI copy). Static scan of every js/ file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const jsDir = join(repoRoot, "js");

const UI_COPY_CALL =
  /\b(showToast|showCloudToast|showNotification|showAppAlert|showAppConfirm|showAppPrompt|showAppPromptWithOption)\s*\(/g;
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const EM_DASH = /—|\\u2014|&mdash;/;

/**
 * Return the source text of the call that opens at `start`, up to its balanced closing paren.
 * @param {string} src - File source
 * @param {number} start - Index of the opening paren
 * @returns {string} The argument list text
 */
function callArguments(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

test("no toast or alert string in js/ contains an em-dash", () => {
  const offenders = [];
  for (const file of readdirSync(jsDir).filter(
    (f) => f.endsWith(".js") && !f.endsWith(".min.js")
  )) {
    const src = readFileSync(join(jsDir, file), "utf-8");
    for (const match of src.matchAll(UI_COPY_CALL)) {
      const args = callArguments(src, match.index + match[0].length - 1);
      for (const literal of args.match(STRING_LITERAL) || []) {
        if (EM_DASH.test(literal)) {
          const line = src.slice(0, match.index).split("\n").length;
          offenders.push(`js/${file}:${line} ${literal}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `Em-dash in UI copy:\n${offenders.join("\n")}`);
});

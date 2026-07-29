// Shared slice-and-eval helpers for unit tests that exercise no-export script-global
// functions/constants from the js/ modules (the app uses script-tag globals, not ES
// exports). Each slices a declaration out of the raw source so a test runs the REAL
// production code/values without importing a non-module file. The sliced source is
// read from the repo's own js/ files, never external input.
//
// This file has no `.test.js` suffix, so `node --test tests/unit/*.test.js` does not
// execute it as a test — it is import-only.

import assert from "node:assert/strict";

/**
 * Slice an arrow-const function body bounded by the first column-0 "\n};" after its
 * declaration head (every nested brace is indented, so "\n};" bounds it precisely).
 * @param {string} src - Source file contents to slice from
 * @param {string} declHead - The `const NAME = (` declaration head to locate
 * @returns {string} The sliced function source, including the closing `};`
 */
export function sliceArrowConst(src, declHead) {
  const start = src.indexOf(declHead);
  assert.ok(start !== -1, `could not locate "${declHead}" in source`);
  const end = src.indexOf("\n};", start) + 3;
  assert.ok(end > start + 2, `could not locate the end of "${declHead}"`);
  return src.slice(start, end);
}

/**
 * Slice a top-level `const NAME = [ … ];` array literal out of source, bounded by the
 * first column-0 "\n];" after the declaration head. Lets a test consume the real
 * production array instead of a hand-copied duplicate that can drift out of sync.
 * @param {string} src - Source file contents to slice from
 * @param {string} declHead - The `const NAME = [` declaration head to locate
 * @returns {string} The sliced array-literal source, including the closing `];`
 */
export function sliceConstArray(src, declHead) {
  const start = src.indexOf(declHead);
  assert.ok(start !== -1, `could not locate "${declHead}" in source`);
  const end = src.indexOf("\n];", start) + 3;
  assert.ok(end > start + 2, `could not locate the end of "${declHead}"`);
  return src.slice(start, end);
}

/**
 * Slice a top-level `function NAME(…) { … }` declaration bounded by the first
 * column-0 "\n}" after its declaration head (every nested brace is indented, so
 * "\n}" bounds it precisely).
 * @param {string} src - Source file contents to slice from
 * @param {string} declHead - The `function NAME(` declaration head to locate
 * @returns {string} The sliced function source, including the closing `}`
 */
export function sliceFunctionDecl(src, declHead) {
  const start = src.indexOf(declHead);
  assert.ok(start !== -1, `could not locate "${declHead}" in source`);
  const end = src.indexOf("\n}", start) + 2;
  assert.ok(end > start + 1, `could not locate the end of "${declHead}"`);
  return src.slice(start, end);
}

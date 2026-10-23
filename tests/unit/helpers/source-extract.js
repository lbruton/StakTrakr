// Shared harness for unit-testing script-tag-global source (no exports, no
// import graph). Code is compiled with its repository path as the filename, so
// Node's coverage credits it to that file:
//
// - evalSource(): evaluates a whole file, or one slice of it, as a function body
//   whose parameters are injected names (window, module, METALS, ...).
// - evalConstantsWindow(): evaluates js/constants.js against a mock window.
// - extractConstFn(): extracts a `const <name> = (...) => {...};` declaration by
//   substring markers (start marker → first column-0 "};") and evaluates it.
//   Marker-based extraction is insensitive to internal formatting; it fails
//   loudly when the declaration moves or is renamed.
//
// Only repository files are evaluated: the same trust domain as running the app.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// Tokens of a never-called arrow function that wraps blanked text. They are short
// so the fence starts on the region's first lines; a newline may sit between any two.
const FENCE_TOKENS = ["(", ")=>", "{"];

/**
 * Reads a repository file as text.
 * @param {string} relPath - Path relative to the repository root.
 * @returns {string}
 */
export const readSource = (relPath) => readFileSync(path.join(REPO_ROOT, relPath), "utf-8");

/**
 * Index of the first run of `length` characters at or after `from` that holds no
 * newline, or -1.
 * @param {string[]} chars - Blanked text as characters.
 * @param {number} from - First index to try.
 * @param {number} length - Run length needed.
 * @returns {number}
 */
const runAt = (chars, from, length) => {
  let run = 0;
  for (let i = from; i < chars.length; i++) {
    run = chars[i] === "\n" ? 0 : run + 1;
    if (run === length) return i - length + 1;
  }
  return -1;
};

/**
 * Blanks text to spaces and wraps it in a function that never runs, so V8 reports
 * the region with a zero count. Tokens go only where spaces were, so every newline
 * keeps its offset. Text too short to wrap stays blank.
 * @param {string} text - Region to replace.
 * @param {string} [lead] - Code written first, such as ";" to end a statement.
 * @returns {string} Text of the same length.
 */
const fenceRegion = (text, lead = "") => {
  const chars = [...text.replace(/[^\n]/g, " ")];
  const place = (token, from) => {
    const at = runAt(chars, from, token.length);
    if (at !== -1) chars.splice(at, token.length, ...token);
    return at === -1 ? -1 : at + token.length;
  };
  let next = lead ? place(lead, 0) : 0;
  if (next === -1) return chars.join("");
  const opened = [...chars];
  for (const token of FENCE_TOKENS) {
    next = next === -1 ? -1 : place(token, next);
  }
  // "};" ends the arrow's expression statement before whatever follows the region.
  let close = chars.length - 2;
  while (close >= next && (chars[close] !== " " || chars[close + 1] !== " ")) close--;
  if (next === -1 || close < next) return opened.join("");
  chars.splice(close, 2, "}", ";");
  return chars.join("");
};

/**
 * Evaluates a repository file, or slices of it, as the body of a function.
 *
 * Slices run inside a copy of the file of the same length: the text around them is
 * blanked and fenced in never-called functions, so offsets match the file and only
 * the slices' lines count as run. `prefix` (for example "return ") sits directly
 * before the first slice on its line; `opener` (for example "return (async () => {")
 * may sit on an earlier line; `suffix` follows the last slice, or the file.
 *
 * @param {string} relPath - File path relative to the repository root.
 * @param {object} [options]
 * @param {Record<string, unknown>} [options.params] - Names injected as parameters.
 * @param {{start: number, end: number} | Array<{start: number, end: number}>} [options.slice]
 *   Offsets into the file; several slices run in file order.
 * @param {string} [options.opener] - Code placed in the last blank run before the first slice.
 * @param {string} [options.prefix] - Code placed directly before the first slice.
 * @param {string} [options.suffix] - Code placed directly after the last slice or file.
 * @returns {unknown} The body's return value.
 */
export const evalSource = (
  relPath,
  { params = {}, slice, opener = "", prefix = "", suffix = "" } = {}
) => {
  const filename = path.join(REPO_ROOT, relPath);
  const source = readFileSync(filename, "utf-8");
  let body = source + suffix;
  if (slice) {
    const slices = [slice].flat().sort((a, b) => a.start - b.start);
    slices.forEach(({ start, end }, i) => {
      const floor = i === 0 ? 0 : slices[i - 1].end;
      assert.ok(floor <= start && start <= end && end <= source.length, `bad slice of ${relPath}`);
    });
    const head = source.slice(0, slices[0].start);
    assert.ok(
      prefix.length <= head.length && !head.slice(head.length - prefix.length).includes("\n"),
      "prefix needs room on the first slice's line"
    );
    const lead = head.slice(0, head.length - prefix.length);
    let at = lead.length;
    if (opener) {
      assert.ok(!opener.includes("\n"), "opener must fit on one line");
      at = lead.length - opener.length;
      while (at >= 0 && lead.slice(at, at + opener.length).includes("\n")) at--;
      assert.ok(at >= 0, "opener needs a blank run before the slice");
    }
    let out =
      fenceRegion(lead.slice(0, at)) +
      opener +
      lead.slice(at + opener.length).replace(/[^\n]/g, " ") +
      prefix;
    slices.forEach(({ start, end }, i) => {
      out += source.slice(start, end);
      if (i + 1 < slices.length) out += fenceRegion(source.slice(end, slices[i + 1].start), ";");
    });
    const tail = source.slice(slices.at(-1).end);
    body =
      out +
      suffix +
      (tail.length > suffix.length ? fenceRegion(tail.slice(suffix.length), ";") : "");
  }
  const names = Object.keys(params);
  const fn = vm.compileFunction(body, names, { filename });
  return fn(...names.map((name) => params[name]));
};

/**
 * Locates a slice by text markers: from `startMarker` through the end of the
 * first `endMarker` after it.
 * @param {string} src - File text from `readSource`.
 * @param {string} startMarker - Text the slice starts with.
 * @param {string} endMarker - Text the slice ends with.
 * @returns {{start: number, end: number}}
 */
export const sliceBetween = (src, startMarker, endMarker) => {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `could not locate ${startMarker}`);
  const at = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(at, -1, `could not locate ${endMarker} after ${startMarker}`);
  return { start, end: at + endMarker.length };
};

/**
 * Offsets of text already cut from `src` (by a regex match or a test-helpers.js
 * slicer), for `evalSource`.
 * @param {string} src - File text from `readSource`.
 * @param {string} text - Exact text of the slice; its first occurrence is used.
 * @returns {{start: number, end: number}}
 */
export const rangeOf = (src, text) => {
  const start = src.indexOf(text);
  assert.notEqual(start, -1, "slice text is not in the source");
  return { start, end: start + text.length };
};

/**
 * Locates a slice by text markers: from `startMarker` up to, not including, the
 * first `stopMarker` after it.
 * @param {string} src - File text from `readSource`.
 * @param {string} startMarker - Text the slice starts with.
 * @param {string} stopMarker - Text directly after the slice.
 * @returns {{start: number, end: number}}
 */
export const sliceUntil = (src, startMarker, stopMarker) => {
  const { start, end } = sliceBetween(src, startMarker, stopMarker);
  return { start, end: end - stopMarker.length };
};

export const evalConstantsWindow = () => {
  const win = {
    location: { search: "", protocol: "https:" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  evalSource("js/constants.js", { params: { window: win } });
  return win;
};

/**
 * Extracts and evaluates `const <name> = <expression>;` from source text.
 * @param {string} src - Source text.
 * @param {string} name - Declared name.
 * @param {Record<string, unknown>} [injected] - Names in scope for the expression.
 * @param {{file?: string}} [options] - `file` (repo-relative) credits coverage to it;
 *   `src` must then be that file's text.
 * @returns {unknown} The evaluated expression.
 */
export const extractConstFn = (src, name, injected = {}, { file } = {}) => {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `could not locate ${marker} in source`);
  const end = src.indexOf("\n};", start);
  assert.notEqual(end, -1, `could not locate the end of ${name}`);
  const slice = { start: start + marker.length, end: end + "\n}".length };
  if (file) {
    assert.equal(src, readSource(file), `src is not the text of ${file}`);
    return evalSource(file, { params: injected, slice, prefix: "return " });
  }
  const names = Object.keys(injected);
  const expr = src.slice(slice.start, slice.end);
  return vm.compileFunction(`return ${expr};`, names)(...names.map((n) => injected[n]));
};

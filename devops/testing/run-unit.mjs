#!/usr/bin/env node
/**
 * Runs the unit suite. With COVERAGE=1 it also writes coverage/unit-lcov.info,
 * limited to the app scripts the harness evaluates (js/ and sw-router.js).
 *
 * Each test process writes raw V8 coverage through NODE_V8_COVERAGE, and
 * mergeUnitCoverage merges it. Node's own coverage merge keeps one process's ranges
 * for a file that several processes evaluate in different slices.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tokenizer } from "acorn";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP_FILE = /^(?:js\/.+\.js|sw-router\.js)$/;

/**
 * Repo-relative app path for a V8 script URL, or null for any other script.
 * Scripts compiled by the unit harness carry a plain absolute path, not a file URL.
 * @param {string} url - Script URL from a V8 entry.
 * @param {string} root - Repository root.
 * @returns {string|null}
 */
function appFileOf(url, root) {
  let filePath;
  if (url.startsWith("file:")) filePath = fileURLToPath(url);
  else if (path.isAbsolute(url)) filePath = url;
  else return null;
  const rel = path.relative(root, filePath).split(path.sep).join("/");
  return APP_FILE.test(rel) ? rel : null;
}

/**
 * Offsets inside comments, so a comment line is not counted as code.
 * @param {string} source - File text.
 * @returns {Uint8Array} 1 at each comment character.
 */
function commentMask(source) {
  const mask = new Uint8Array(source.length);
  const onComment = (block, text, start, end) => mask.fill(1, start, end);
  for (const sourceType of ["script", "module"]) {
    try {
      mask.fill(0);
      const options = { ecmaVersion: "latest", sourceType, allowHashBang: true, onComment };
      for (const token of tokenizer(source, options)) void token;
      return mask;
    } catch {
      // A file the tokenizer rejects as a script may be a module.
    }
  }
  return mask.fill(0);
}

/**
 * Line starts and a running count of code characters (not whitespace or comment).
 * @param {string} source - File text.
 * @returns {{source: string, starts: number[], code: Int32Array, lineOf: Function}}
 */
function indexSource(source) {
  const starts = [0];
  const code = new Int32Array(source.length + 1);
  const comments = commentMask(source);
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
    code[i + 1] = code[i] + (comments[i] || /\s/.test(source[i]) ? 0 : 1);
  }
  const lineOf = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  return { source, starts, code, lineOf };
}

/**
 * Segments of one entry with the count of the innermost range holding each. The
 * harness fences text outside a slice in zero-count functions nested in the
 * top-level range, so only the innermost range tells a fenced line from a run one.
 * Ranges past the end of the file belong to code the harness appends.
 * @param {object[]} functions - V8 functions of one entry.
 * @param {number} length - Length of the file's source.
 * @returns {Array<{start: number, end: number, count: number}>}
 */
function innermostSegments(functions, length) {
  const ranges = functions
    .flatMap((fn) => fn.ranges)
    .filter((range) => range.startOffset < length)
    .map((range) => ({ ...range, endOffset: Math.min(range.endOffset, length) }))
    .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const bounds = [...new Set(ranges.flatMap((r) => [r.startOffset, r.endOffset]))].sort(
    (a, b) => a - b
  );
  const segments = [];
  const open = [];
  let next = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    while (open.length && open.at(-1).endOffset <= start) open.pop();
    while (next < ranges.length && ranges[next].startOffset <= start) {
      const range = ranges[next++];
      if (range.endOffset > start) open.push(range);
    }
    if (open.length) segments.push({ start, end: bounds[i + 1], count: open.at(-1).count });
  }
  return segments;
}

/**
 * Marks the lines that hold code of a segment with a positive count.
 * @param {ReturnType<typeof indexSource>} text - Indexed source.
 * @param {Array<{start: number, end: number, count: number}>} segments - From innermostSegments.
 * @param {Set<number>} hit - Hit lines, updated in place.
 */
function markLines(text, segments, hit) {
  const { starts, code, lineOf } = text;
  for (const { start, end, count } of segments) {
    if (count === 0 || code[end] === code[start]) continue;
    for (let line = lineOf(start); line <= lineOf(end - 1); line++) {
      const from = Math.max(start, starts[line - 1]);
      const to = Math.min(end, starts[line] ?? end);
      if (code[to] > code[from]) hit.add(line);
    }
  }
}

/**
 * Adds the entry's block ranges to `blocks` as `start-end` keys. A top-level block
 * that reaches the end of the file is the unreachable tail after the harness's
 * `return` before a slice, not a branch of the file.
 * @param {object[]} functions - V8 functions of one entry.
 * @param {number} length - Length of the file's source.
 * @param {Set<string>} blocks - Block keys seen so far, updated in place.
 */
function collectBlocks(functions, length, blocks) {
  for (const fn of functions) {
    const [outer, ...inner] = fn.ranges;
    const topLevel = outer.startOffset === 0 && outer.endOffset >= length;
    for (const range of inner) {
      if (range.startOffset >= length || (topLevel && range.endOffset >= length)) continue;
      blocks.add(`${range.startOffset}-${Math.min(range.endOffset, length)}`);
    }
  }
}

/**
 * Count of the innermost range at `offset` in one entry's segments, or 0 outside them.
 * V8 leaves out a block whose count equals its parent's, so a block one entry ran may
 * appear only in another entry; the enclosing range holds its count.
 * @param {Array<{start: number, end: number, count: number}>} segments - From innermostSegments.
 * @param {number} offset - Source offset.
 * @returns {number}
 */
function countAt(segments, offset) {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].end <= offset) lo = mid + 1;
    else if (segments[mid].start > offset) hi = mid - 1;
    else return segments[mid].count;
  }
  return 0;
}

/**
 * Lcov section for one file: every line that holds code, and every block as a branch.
 * Counts are written as 1 or 0. Some app code branches on the clock, so execution
 * counts differ between runs; whether a line or block ran does not.
 * @param {string} file - Repo-relative path.
 * @param {ReturnType<typeof indexSource>} text - Indexed source.
 * @param {Set<number>} hit - Hit lines.
 * @param {Set<string>} blocks - Block keys from collectBlocks.
 * @param {Array<Array<{start: number, end: number, count: number}>>} entries - Segments
 *   of every entry for the file.
 * @returns {string}
 */
function lcovSection(file, text, hit, blocks, entries) {
  const out = [`SF:${file}`];
  const branches = [...blocks]
    .map((key) => key.split("-").map(Number))
    .map(([start, end]) => [start, end, entries.some((segs) => countAt(segs, start) > 0)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  branches.forEach(([start, , ran], i) => {
    out.push(`BRDA:${text.lineOf(start)},${i},0,${ran ? 1 : 0}`);
  });
  out.push(`BRF:${branches.length}`, `BRH:${branches.filter(([, , ran]) => ran).length}`);
  let found = 0;
  text.starts.forEach((start, i) => {
    const end = text.starts[i + 1] ?? text.source.length;
    if (text.code[end] === text.code[start]) return;
    found++;
    out.push(`DA:${i + 1},${hit.has(i + 1) ? 1 : 0}`);
  });
  out.push(`LF:${found}`, `LH:${hit.size}`, "end_of_record");
  return out.join("\n");
}

/**
 * Merges the raw V8 coverage files in `rawDir` into lcov for the app scripts. A line or
 * block counts as run when any process ran it.
 * @param {object} options
 * @param {string} options.rawDir - Directory that NODE_V8_COVERAGE wrote.
 * @param {string} options.outFile - Path of the lcov file to write.
 * @param {string} [options.root] - Repository root the sources are read from.
 * @returns {Promise<string>} The lcov path.
 */
export async function mergeUnitCoverage({ rawDir, outFile, root = REPO_ROOT }) {
  const files = new Map();
  for (const name of readdirSync(rawDir).filter((n) => n.endsWith(".json"))) {
    const { result = [] } = JSON.parse(readFileSync(path.join(rawDir, name), "utf-8"));
    for (const { url, functions } of result) {
      const file = appFileOf(url, root);
      if (!file) continue;
      if (!files.has(file)) {
        const text = indexSource(readFileSync(path.join(root, file), "utf-8"));
        files.set(file, { text, hit: new Set(), blocks: new Set(), entries: [] });
      }
      const { text, hit, blocks, entries } = files.get(file);
      const segments = innermostSegments(functions, text.source.length);
      entries.push(segments);
      markLines(text, segments, hit);
      collectBlocks(functions, text.source.length, blocks);
    }
  }
  const sections = [...files]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, { text, hit, blocks, entries }]) => lcovSection(file, text, hit, blocks, entries));
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, sections.length ? `${sections.join("\n")}\n` : "");
  return outFile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const coverage = process.env.COVERAGE === "1";
  const rawDir = coverage ? mkdtempSync(path.join(tmpdir(), "strk-unit-raw-")) : null;
  const env = coverage ? { ...process.env, NODE_V8_COVERAGE: rawDir } : process.env;
  const run = spawnSync(process.execPath, ["--test", "tests/unit/*.test.js"], {
    cwd: REPO_ROOT,
    env,
    stdio: "inherit",
  });
  if (coverage) {
    try {
      await mergeUnitCoverage({
        rawDir,
        outFile: path.join(REPO_ROOT, "coverage", "unit-lcov.info"),
      });
    } finally {
      rmSync(rawDir, { recursive: true, force: true });
    }
  }
  process.exit(run.status ?? 1);
}

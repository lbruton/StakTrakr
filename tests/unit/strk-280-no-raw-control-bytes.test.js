// Unit tests for STRK-280: tracked first-party source must not contain raw
// control bytes.
//
// js/cloud-sync.js and js/priceHistory.js carried literal NUL (0x00) bytes
// inside string literals, used as a join separator for comparison fingerprints.
// NUL is a legitimate separator choice — the defect is that it was stored as a
// raw control byte in the source file rather than as an escape sequence.
//
// Blast radius observed before the fix: CodeGraphContext stores a variable's
// initializer text as a graph property, FalkorDB cannot serialize a NUL inside
// a query parameter, so the write hard-failed and aborted the entire repository
// index. StakTrakr's code graph therefore held zero real application source
// from ~2026-06-17 until this was found — structural queries (callers, call
// chains, dead code) were silently answered from a stale snapshot.
//
// The escape used is the hex form (backslash-x-0-0) rather than the unicode
// form (backslash-u-0-0-0-0). Both denote U+0000 and are runtime-identical, but
// the unicode form is itself hazardous to handle: tooling that decodes
// backslash-u escapes round-trips it straight back into a raw NUL, which is the
// failure mode this issue exists to remove. The hex form is not subject to that
// decoding, so it survives edit tooling intact.
//
// This test is the recurrence guard requested by the issue's third acceptance
// criterion. It is deliberately a repo-wide sweep, not two hardcoded paths, so
// a NUL introduced anywhere in first-party source fails the suite.
//
// Run: npm run test:unit

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Extensions we treat as text. Anything else (png, woff2, ico) is binary by
// nature and control bytes there are expected, not a defect.
const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".html",
  ".md",
  ".sh",
  ".yml",
  ".yaml",
  ".csv",
  ".toml",
  ".txt",
  ".svg",
]);

// Third-party minified bundles are not ours to reformat, and minifiers do emit
// control bytes inside string tables (jszip carries 0x01-0x07). Excluded so the
// guard stays actionable.
const EXCLUDED_PREFIXES = ["vendor/"];

// Tab, line feed, carriage return are legitimate in text files.
const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0d]);

// Built from a char code so this file never contains the escape it asserts on.
const BACKSLASH = String.fromCharCode(92);
const HEX_NUL_ESCAPE = `${BACKSLASH}x00`;

/**
 * Reports whether a byte is a control byte disallowed in tracked text source.
 * Covers the C0 range minus tab/LF/CR, plus DEL.
 *
 * @param {number} byte - Byte value, 0-255
 * @returns {boolean} True when the byte must not appear in text source
 */
const isDisallowedControlByte = (byte) =>
  (byte < 0x20 && !ALLOWED_CONTROL_BYTES.has(byte)) || byte === 0x7f;

/**
 * Lists tracked text files, excluding vendored third-party bundles.
 * Uses git rather than a directory walk so untracked scratch files and
 * gitignored build output are never scanned.
 *
 * @returns {string[]} Repository-relative paths
 */
const listTrackedTextFiles = () =>
  execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((rel) => TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase()))
    .filter((rel) => !EXCLUDED_PREFIXES.some((prefix) => rel.startsWith(prefix)))
    .filter((rel) => {
      // A tracked path can be absent in a partial checkout or mid-rebase state.
      try {
        return statSync(path.join(REPO_ROOT, rel)).isFile();
      } catch {
        return false;
      }
    });

/**
 * Finds every disallowed control byte in a file, with line numbers, so a
 * failure message points at the offending location instead of just the file.
 *
 * @param {string} rel - Repository-relative path
 * @returns {Array<{line: number, byte: string}>} One entry per occurrence
 */
const findControlBytes = (rel) => {
  const data = readFileSync(path.join(REPO_ROOT, rel));
  const found = [];
  let line = 1;
  for (const byte of data) {
    if (byte === 0x0a) {
      line += 1;
      continue;
    }
    if (isDisallowedControlByte(byte)) {
      found.push({ line, byte: `0x${byte.toString(16).padStart(2, "0")}` });
    }
  }
  return found;
};

describe("STRK-280 no raw control bytes in tracked source", () => {
  it("finds no disallowed control byte in any tracked first-party text file", () => {
    const offenders = listTrackedTextFiles()
      .map((rel) => ({ rel, hits: findControlBytes(rel) }))
      .filter((entry) => entry.hits.length > 0);

    const report = offenders
      .map(({ rel, hits }) => `${rel}: ${hits.map((h) => `line ${h.line} ${h.byte}`).join(", ")}`)
      .join("\n");

    assert.equal(
      offenders.length,
      0,
      `Raw control bytes found in tracked source. Replace each with an escape ` +
        `sequence (${HEX_NUL_ESCAPE} for NUL):\n${report}`
    );
  });

  it("scans a meaningful number of files, so a broken filter cannot pass vacuously", () => {
    // Without this, a bad extension filter or a git failure would yield an empty
    // list and the sweep above would report success having checked nothing.
    assert.ok(
      listTrackedTextFiles().length > 100,
      "expected the tracked-text-file sweep to cover a substantial part of the repo"
    );
  });

  it("keeps the NUL separator semantics in the two files that used one", () => {
    // The fix must not change the separator, only how it is spelled in source.
    // A "fix" that swapped NUL for a comma or pipe would silently alter the
    // fingerprint collision surface for tag and price-history comparisons.
    for (const rel of ["js/cloud-sync.js", "js/priceHistory.js"]) {
      const source = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      assert.ok(
        source.includes(`join("${HEX_NUL_ESCAPE}")`),
        `${rel} must still join on U+0000, written as the ${HEX_NUL_ESCAPE} escape`
      );
    }
  });

  it("still treats a raw NUL as disallowed even though vendor bundles are skipped", () => {
    // Guards the exclusion list itself: broadening EXCLUDED_PREFIXES to silence
    // a real finding would otherwise go unnoticed.
    assert.equal(isDisallowedControlByte(0x00), true);
    assert.equal(isDisallowedControlByte(0x09), false);
    assert.equal(isDisallowedControlByte(0x0a), false);
    assert.equal(isDisallowedControlByte(0x0d), false);
    assert.equal(isDisallowedControlByte(0x7f), true);
    assert.deepEqual(EXCLUDED_PREFIXES, ["vendor/"]);
  });
});

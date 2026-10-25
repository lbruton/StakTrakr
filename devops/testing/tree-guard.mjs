/**
 * Fails a test run that writes anywhere but ignored temp output. It compares
 * `git status` and the content of every listed path before and after the run, so
 * edits made before the run pass unless the run changes them again.
 * Serves as the `node --test --test-global-setup` module; Playwright wraps it in
 * tests/playwright/helpers/tree-guard.js.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ENV_KEY = "TREE_GUARD_SNAPSHOT";
const MISSING = "missing";

/**
 * Root of the git work tree that holds `cwd`, or null outside one.
 * @param {string} cwd - Directory to resolve from.
 * @returns {string|null}
 */
function workTreeRoot(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Content hash of each path `git status` lists: changed or deleted tracked files and
 * untracked files that are not ignored. A clean tree yields an empty object.
 * @param {string} [cwd] - Any directory inside the work tree.
 * @returns {Record<string, string>|null} Null outside a git work tree.
 */
export function snapshotTree(cwd = process.cwd()) {
  const root = workTreeRoot(cwd);
  if (!root) return null;
  const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  const entries = out.split("\0");
  const snapshot = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const paths = [entry.slice(3)];
    // A rename or copy entry is followed by its source path.
    if (/[RC]/.test(entry.slice(0, 2))) paths.push(entries[++i]);
    for (const rel of paths) {
      const file = path.join(root, rel);
      snapshot[rel] = existsSync(file)
        ? createHash("sha1").update(readFileSync(file)).digest("hex")
        : MISSING;
    }
  }
  return snapshot;
}

/**
 * Paths whose status or content differs between two snapshots, sorted.
 * @param {Record<string, string>} before - Snapshot taken before the run.
 * @param {Record<string, string>} after - Snapshot taken after the run.
 * @returns {string[]}
 */
export function strayWrites(before, after) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].filter((rel) => before[rel] !== after[rel]).sort();
}

/**
 * Error message for a run that wrote outside temp output, or null for a clean run.
 * @param {Record<string, string>|null} before - Snapshot taken before the run.
 * @param {string} [cwd] - Any directory inside the work tree.
 * @returns {string|null}
 */
export function checkTree(before, cwd = process.cwd()) {
  if (!before) return null;
  const after = snapshotTree(cwd);
  if (!after) return null;
  const stray = strayWrites(before, after);
  if (!stray.length) return null;
  return [
    "Tests changed files in the work tree. A test writes only to temp output:",
    "testInfo.outputPath() in Playwright, os.tmpdir() in unit tests.",
    ...stray.map((rel) => `  ${rel}`),
  ].join("\n");
}

/** Records the work tree before the run; see checkTree. */
export async function globalSetup() {
  process.env[ENV_KEY] = JSON.stringify(snapshotTree());
}

/** Fails the run when checkTree reports a stray write. */
export async function globalTeardown() {
  const message = checkTree(JSON.parse(process.env[ENV_KEY] ?? "null"));
  if (!message) return;
  console.error(`\n${message}\n`);
  process.exitCode = 1;
}

/**
 * Playwright form of globalTeardown: a thrown error fails the run.
 * @returns {Promise<void>}
 */
export async function assertTreeUnchanged() {
  const message = checkTree(JSON.parse(process.env[ENV_KEY] ?? "null"));
  if (message) throw new Error(message);
}

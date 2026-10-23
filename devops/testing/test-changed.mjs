#!/usr/bin/env node
/**
 * Runs only the tests a change can affect.
 *
 * Core tests come from the test map (.cache/test-map.json): a changed line inside a
 * function selects the tests that ran that line, or the tests that ran the function when
 * the map has no line index. Unit tests come from the paths each unit
 * test, or a helper it imports, reads. Shared files and top-level code select the
 * full core suite; docs and config paths select nothing.
 *
 * Usage: node devops/testing/test-changed.mjs [--fetch] [--plan-only] [--json <path>]
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadDevArtifact } from "./dev-artifacts.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MAP_PATH = path.join(REPO_ROOT, ".cache", "test-map.json");
const ALL_UNIT = "tests/unit/*.test.js";
const MAP_HINT =
  "Build the map with `npm run test:map`, or download dev's with `npm run test:changed -- --fetch`.";

const SPEC_FILE = /^tests\/playwright\/(core|extended)\/.+\.spec\.js$/;
const APP_SCRIPT = /^js\/[^/]+\.js$/;
// Paths that change how every unit test runs.
const ALL_UNIT_PATHS = [/^package(-lock)?\.json$/, /^devops\/testing\/run-unit\.mjs$/];
// Paths no test exercises. Anything else the map cannot place selects the full core suite.
const TEST_FREE_PATHS = [
  /\.md$/,
  /^(docs|\.context|\.claude|\.agents|\.codex|\.archive|\.vale|\.codacy|playground|screenshots)\//,
  /^\.github\/(?!workflows\/tests\.yml$)/,
  /^devops\//,
  /^tests\/unit\//,
  /^tests\/runbook\//,
  /^tests\/playwright\/evidence\//,
  /^tests\/playwright\/[^/]+\.(md|csv)$/,
  /^\.(gitignore|gitattributes|prettierrc|prettierignore|markdownlint\.json|markdownlintignore|vale\.ini|coderabbit\.yaml|codacy\.yml|pre-commit-config\.yaml|dockerignore|geminiignore|npmrc|eslintrc\.json|nojekyll)$/,
  /^eslint\.config\.cjs$/,
  /^LICENSE/,
];
const REPO_PATH =
  /(?:^|[^\w.-])((?:js|css|data|vendor|devops|tests|functions)\/[\w./-]+\.(?:m?js|json|css|html|sh)|sw-router\.js|sw\.js|index\.html)/g;
// Any relative file literal (an import, a `new URL(...)`, a read), resolved against the test's folder.
const RELATIVE_FILE = /["'`](\.{1,2}\/[^"'`\s]+\.(?:m?js|json|css|html|sh|csv))["'`]/g;
// `join(ROOT, "devops", "pollers", "run-lock.sh")`: a path built from string segments.
const JOINED_PATH = /\bjoin\(\s*[\w.]+\s*((?:,\s*["'][^"']+["']\s*)+)\)/g;
// A test that lists the tracked files checks every root-level file.
const LISTS_REPO = /["']ls-files["']/;
const ROOT_FILES = "<root files>";
// A bare data directory (`"data/collections"`) means its files are read.
const DATA_DIRECTORY = /["'`]((?:data|tests\/fixtures)(?:\/[\w-]+)+)\/?["'`]/g;
// A test that lists a directory depends on every file in each repo directory it names.
const DIRECTORY_SCAN = /\breaddirSync\s*\(/;
const DIRECTORY_NAME = /["'](js|css|data|vendor|tests\/playwright\/(?:core|extended))\/?["']/g;

/**
 * Parses `git diff -U0` output into the changed lines on the old side of each file.
 * A pure insertion goes to `inserts` as the old line it follows (0 at the file start).
 * A deleted file keeps its old path and carries `deleted: true`; a binary or mode-only
 * change, which has no `+++` header, keeps the path from its `diff --git` line.
 * @param {string} text - Diff text.
 * @returns {Array<{file: string, lines: number[], inserts?: number[], deleted?: boolean}>}
 */
export function parseDiff(text) {
  const changes = [];
  let current = null;
  let added = false;
  let oldFile = null;
  let header = null;
  // A file block that ended without a `+++` header still changed.
  const flushHeader = () => {
    if (header && !current) {
      changes.push(
        header.deleted
          ? { file: header.file, lines: [], deleted: true }
          : { file: header.file, lines: [] }
      );
    }
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flushHeader();
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      header = match ? { file: match[2], deleted: false } : null;
      current = null;
      added = false;
      oldFile = null;
    } else if (header && line.startsWith("deleted file mode")) {
      header.deleted = true;
    } else if (line.startsWith("--- ")) {
      added = line === "--- /dev/null";
      oldFile = added ? null : line.slice("--- a/".length);
    } else if (line.startsWith("+++ ")) {
      current =
        line === "+++ /dev/null"
          ? { file: oldFile, lines: [], deleted: true }
          : { file: line.slice("+++ b/".length), lines: [] };
      if (current.file) changes.push(current);
    } else if (current && line.startsWith("@@ ")) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+/);
      if (!match || added || current.deleted) continue;
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      if (count === 0) (current.inserts ??= []).push(start);
      else for (let n = start; n < start + count; n++) current.lines.push(n);
    }
  }
  flushHeader();
  return changes;
}

/**
 * Repository paths one source file reads or imports; a trailing "/" marks a directory.
 * @param {string} file - Repo path of the source.
 * @param {string} text - Its contents.
 * @returns {Set<string>}
 */
function directRefs(file, text) {
  const refs = new Set();
  for (const match of text.matchAll(REPO_PATH)) refs.add(match[1]);
  for (const match of text.matchAll(RELATIVE_FILE)) {
    refs.add(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
  }
  for (const match of text.matchAll(JOINED_PATH)) {
    const segments = [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    refs.add(path.posix.normalize(segments.join("/")));
  }
  if (LISTS_REPO.test(text)) refs.add(ROOT_FILES);
  for (const match of text.matchAll(DATA_DIRECTORY)) refs.add(`${match[1]}/`);
  if (DIRECTORY_SCAN.test(text)) {
    for (const match of text.matchAll(DIRECTORY_NAME)) refs.add(`${match[1]}/`);
  }
  return refs;
}

/**
 * Maps each unit test file to the repository paths it reads, directly or through the
 * modules it imports.
 * @param {Record<string, string>} files - Unit tests and the modules they import, by repo path.
 * @returns {Map<string, Set<string>>} Unit test file → referenced paths.
 */
export function buildUnitIndex(files) {
  const direct = new Map();
  for (const [file, text] of Object.entries(files)) direct.set(file, directRefs(file, text));
  const index = new Map();
  for (const file of direct.keys()) {
    if (!file.endsWith(".test.js")) continue;
    const seen = new Set();
    const queue = [...direct.get(file)];
    while (queue.length) {
      const ref = queue.pop();
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (direct.has(ref)) queue.push(...direct.get(ref));
    }
    index.set(file, seen);
  }
  return index;
}

/**
 * Old-side lines whose line-index sets stand for an insertion inside a function: the line
 * after it, and the line before when the line after is blank or a closing brace.
 * @param {number} before - Old line the insertion follows.
 * @param {(line: number) => string|undefined} lineText - Old-side text of a line.
 * @returns {number[]}
 */
function insertionLines(before, lineText) {
  const next = lineText(before + 1);
  if (next === undefined) return [before];
  return /^\s*(\}|$)/.test(next) ? [before, before + 1] : [before + 1];
}

/**
 * Picks the core tests for changed lines of one mapped js/ file.
 * @param {object} options
 * @param {string} options.file - Changed js/ file.
 * @param {{lines: number[], inserts?: number[]}} options.change - Its changed lines.
 * @param {object} options.map - Test map.
 * @param {(file: string, line: number) => string|undefined} options.oldLine - Old-side text.
 * @param {(id: string, file: string) => void} options.pickTest - Selects one test.
 * @param {(file: string, why: string) => void} options.full - Selects the full suite.
 */
function selectInScript({ file, change, map, oldLine, pickTest, full }) {
  const ranges = map.files?.[file];
  const testsInFile = map.tests.filter((t) => t.functions.some((fn) => fn.file === file));
  // Without `files`, only the functions some test ran are known.
  const known =
    ranges ??
    testsInFile.flatMap((t) =>
      t.functions.filter((fn) => fn.file === file).map((fn) => [fn.startLine, fn.endLine])
    );
  const runs = map.sets ? map.lines?.[file] : undefined;
  // A line runs only when its innermost enclosing function runs, so a module
  // wrapper that every boot enters does not select every test.
  const innermost = (first, last) =>
    known
      .filter(([start, end]) => start <= first && last <= end)
      .sort((a, b) => a[1] - a[0] - (b[1] - b[0]))[0];
  const pickFunction = (inner) =>
    testsInFile
      .filter((t) =>
        t.functions.some(
          (fn) => fn.file === file && fn.startLine === inner[0] && fn.endLine === inner[1]
        )
      )
      .forEach((t) => pickTest(t.id, file));
  const pickLine = (line) => {
    const run = runs?.find(([start, end]) => start <= line && line <= end);
    if (!run) return false;
    for (const index of map.sets[run[2]]) pickTest(map.tests[index].id, file);
    return true;
  };

  for (const line of change.lines) {
    const inner = innermost(line, line);
    if (!inner) full(file, `line ${line} is top-level code that every boot runs`);
    else if (!pickLine(line)) pickFunction(inner);
  }
  // An insertion runs in the innermost function that holds both of its neighbours. Just
  // before a function's first line or after its last, that is the scope around it.
  for (const before of change.inserts ?? []) {
    const scope = innermost(before, before + 1);
    if (!scope) {
      full(file, `an insertion after line ${before} is top-level code that every boot runs`);
      continue;
    }
    const lines = runs ? insertionLines(before, (n) => oldLine(file, n)) : [];
    const picked = lines.map(pickLine);
    if (!picked.length || picked.includes(false)) pickFunction(scope);
  }
}

/**
 * Selects the core and unit tests a set of changes can affect.
 * @param {object} options
 * @param {object|null} options.map - Test map, or null when none exists.
 * @param {Array<{file: string, lines: number[], inserts?: number[]}>} options.changes - Changed files.
 * @param {Map<string, Set<string>>} options.unitIndex - From `buildUnitIndex`.
 * @param {Set<string>} [options.serialSpecs] - Specs with a serial group; a selected
 *   test there runs its whole spec, because a serial test needs the tests before it.
 * @param {(file: string, line: number) => string|undefined} [options.oldLine] - Text of a
 *   line at the map's commit, for placing inserted lines.
 * @returns {{full: boolean, allUnit: boolean, reasons: Array<{file: string, why: string}>,
 *   core: Array<{location: string, files: string[]}>, unit: Array<{file: string, files: string[]}>,
 *   missingMap: boolean}}
 */
export function selectTests({
  map,
  changes,
  unitIndex,
  serialSpecs = new Set(),
  oldLine = () => undefined,
}) {
  const core = new Map();
  const unit = new Map();
  const reasons = [];
  let allUnit = false;
  let missingMap = false;
  const pick = (into, key, file) => {
    if (!into.has(key)) into.set(key, new Set());
    into.get(key).add(file);
  };
  const full = (file, why) => reasons.push({ file, why });

  // The map still lists tests of a spec this change deletes; there is nothing left to run.
  const deletedSpecs = new Set(changes.filter((c) => c.deleted).map((c) => c.file));
  const pickTest = (id, file) => {
    const spec = id.replace(/:\d+$/, "");
    if (deletedSpecs.has(spec)) return;
    pick(core, serialSpecs.has(spec) ? spec : id, file);
  };

  for (const change of changes) {
    const { file, lines, inserts = [], deleted } = change;
    for (const [unitFile, refs] of unitIndex) {
      const inScannedDir =
        [...refs].some((ref) => ref.endsWith("/") && file.startsWith(ref)) ||
        (refs.has(ROOT_FILES) && !file.includes("/"));
      if (unitFile === file || refs.has(file) || inScannedDir) pick(unit, unitFile, file);
    }
    if (ALL_UNIT_PATHS.some((re) => re.test(file))) allUnit = true;

    if (SPEC_FILE.test(file)) {
      if (!deleted) pick(core, file, file);
    } else if (APP_SCRIPT.test(file)) {
      if (!map) {
        missingMap = true;
        full(file, "no test map to place this file");
        continue;
      }
      if (
        !map.files?.[file] &&
        !map.tests.some((t) => t.functions.some((fn) => fn.file === file))
      ) {
        full(file, "no core test loads this file in the test map");
        continue;
      }
      if (lines.length === 0 && inserts.length === 0)
        full(file, deleted ? "the file was deleted" : "the whole file changed");
      selectInScript({ file, change, map, oldLine, pickTest, full });
    } else if (!TEST_FREE_PATHS.some((re) => re.test(file))) {
      full(file, "a shared file no test map entry covers");
    }
  }

  // A spec selected whole already runs its single-test locations.
  for (const location of [...core.keys()]) {
    const spec = location.replace(/:\d+$/, "");
    if (spec !== location && core.has(spec)) {
      core.get(location).forEach((file) => core.get(spec).add(file));
      core.delete(location);
    }
  }
  const list = (into, key) =>
    [...into]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, files]) => ({ [key]: name, files: [...files].sort() }));
  return {
    full: reasons.length > 0,
    allUnit,
    reasons,
    core: list(core, "location"),
    unit: list(unit, "file"),
    missingMap,
  };
}

/**
 * The plan as text: each selected test with the changed files that selected it.
 * @param {ReturnType<typeof selectTests>} selection
 * @returns {string}
 */
export function renderPlan(selection) {
  const lines = [];
  if (selection.full) {
    lines.push("Core: the full suite, because:");
    for (const { file, why } of selection.reasons) lines.push(`  ${file}: ${why}`);
    if (selection.missingMap) lines.push(`  ${MAP_HINT}`);
  } else if (selection.core.length) {
    lines.push(`Core: ${selection.core.length} test location(s)`);
    for (const { location, files } of selection.core)
      lines.push(`  ${location}  ← ${files.join(", ")}`);
  } else {
    lines.push("Core: no test selected");
  }
  if (selection.allUnit) {
    lines.push("Unit: the full suite (test tooling changed)");
  } else if (selection.unit.length) {
    lines.push(`Unit: ${selection.unit.length} file(s)`);
    for (const { file, files } of selection.unit) lines.push(`  ${file}  ← ${files.join(", ")}`);
  } else {
    lines.push("Unit: no test selected");
  }
  return lines.join("\n");
}

/**
 * The plan as JSON for CI.
 * @param {ReturnType<typeof selectTests>} selection
 * @returns {{full: boolean, core: string[], unit: string[], reasons: Array<{file: string, why: string}>}}
 */
export function toPlanJson(selection) {
  return {
    full: selection.full,
    // With the full core suite, only selected locations outside core/ still need naming.
    core: selection.core
      .map((entry) => entry.location)
      .filter((location) => !selection.full || !location.startsWith("tests/playwright/core/")),
    unit: selection.allUnit ? [ALL_UNIT] : selection.unit.map((entry) => entry.file),
    reasons: selection.reasons,
  };
}

/**
 * A warning when the map was not built from this branch's history.
 * @param {{mapSha: string, mergeBase: string, isAncestor: (a: string, b: string) => boolean}} options
 * @returns {string|null}
 */
export function staleWarning({ mapSha, mergeBase, isAncestor }) {
  if (!mapSha || !mergeBase || isAncestor(mapSha, mergeBase)) return null;
  return `Warning: the test map is stale. It was built from ${mapSha.slice(0, 8)}, which is not in this branch's history from origin/dev. ${MAP_HINT}`;
}

// --- Command line -------------------------------------------------------------------

const git = (args, options = {}) =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 64 << 20, ...options });
const gitOk = (args) => spawnSync("git", args, { cwd: REPO_ROOT }).status === 0;

/** Downloads the test map from the latest successful `dev` push run of the Tests workflow. */
function fetchMap() {
  if (!downloadDevArtifact("test-map", path.dirname(MAP_PATH), REPO_ROOT)) {
    console.log("No successful dev run has published a test map yet.");
  }
}

/** Reads the unit tests and helpers that the unit index scans. */
function unitSources() {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(m?js)$/.test(entry.name))
        files[rel] = readFileSync(path.join(REPO_ROOT, rel), "utf-8");
    }
  };
  walk("tests/unit");
  // Follow imports into tooling modules (devops/, Playwright helpers) so their reads
  // count too; app scripts under js/ are matched by path, not scanned.
  const queue = Object.keys(files);
  while (queue.length) {
    const file = queue.pop();
    for (const ref of directRefs(file, files[file])) {
      if (files[ref] !== undefined || !/^(devops|tests\/playwright\/helpers)\/.+\.m?js$/.test(ref))
        continue;
      if (!existsSync(path.join(REPO_ROOT, ref))) continue;
      files[ref] = readFileSync(path.join(REPO_ROOT, ref), "utf-8");
      queue.push(ref);
    }
  }
  return files;
}

/** Specs that declare a serial group (`describe.serial` or serial mode). */
function serialSpecs() {
  const specs = new Set();
  for (const dir of ["tests/playwright/core", "tests/playwright/extended"]) {
    for (const name of readdirSync(path.join(REPO_ROOT, dir))) {
      if (!name.endsWith(".spec.js")) continue;
      const text = readFileSync(path.join(REPO_ROOT, dir, name), "utf-8");
      if (/describe\.serial|mode:\s*["']serial["']/.test(text)) specs.add(`${dir}/${name}`);
    }
  }
  return specs;
}

/**
 * Line lookup in files as they were at `base`, read once per file.
 * @param {string} base - Commit the diff was taken against.
 * @returns {(file: string, line: number) => string|undefined}
 */
function oldLineReader(base) {
  const cache = new Map();
  return (file, line) => {
    if (!cache.has(file)) {
      const text = spawnSync("git", ["show", `${base}:${file}`], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        maxBuffer: 64 << 20,
      });
      cache.set(file, text.status === 0 ? text.stdout.split("\n") : []);
    }
    return cache.get(file)[line - 1];
  };
}

/** Changed files against `base`, working tree and untracked files included. */
function changesSince(base) {
  const diff = git(["diff", "-U0", "--no-renames", "--no-color", base]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    .map((file) => ({ file, lines: [] }));
  return [...parseDiff(diff), ...untracked];
}

function main(argv) {
  const flag = (name) => argv.includes(name);
  const jsonAt = argv.indexOf("--json");
  if (flag("--fetch")) fetchMap();

  const map = existsSync(MAP_PATH) ? JSON.parse(readFileSync(MAP_PATH, "utf-8")) : null;
  const mergeBase = gitOk(["rev-parse", "--verify", "-q", "origin/dev"])
    ? git(["merge-base", "HEAD", "origin/dev"]).trim()
    : null;
  const mapUsable = map && gitOk(["cat-file", "-e", `${map.sha}^{commit}`]);
  const base = mapUsable ? map.sha : mergeBase || "HEAD";
  if (map && !mapUsable) {
    console.log(
      `Warning: the test map's commit ${map.sha.slice(0, 8)} is not in this clone, so the map is not used. Run \`git fetch origin dev\`.`
    );
  }
  const warning =
    mapUsable && mergeBase
      ? staleWarning({
          mapSha: map.sha,
          mergeBase,
          isAncestor: (a, b) => gitOk(["merge-base", "--is-ancestor", a, b]),
        })
      : null;
  if (warning) console.log(warning);

  const selection = selectTests({
    // Line numbers diffed from another base would not match the map's ranges.
    map: mapUsable ? map : null,
    changes: changesSince(base),
    unitIndex: buildUnitIndex(unitSources()),
    serialSpecs: serialSpecs(),
    oldLine: oldLineReader(base),
  });
  console.log(renderPlan(selection));
  const plan = toPlanJson(selection);
  if (jsonAt !== -1) writeFileSync(path.resolve(argv[jsonAt + 1]), JSON.stringify(plan, null, 2));
  if (flag("--plan-only")) return 0;

  let status = 0;
  if (plan.unit.length) {
    status ||= spawnSync(process.execPath, ["--test", ...plan.unit], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    }).status;
  }
  const coreArgs = plan.full ? ["tests/playwright/core", ...plan.core] : plan.core;
  if (coreArgs.length) {
    const run = spawnSync("npx", ["playwright", "test", ...coreArgs], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    status ||= run.status;
  }
  return status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}

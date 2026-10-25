#!/usr/bin/env node
/**
 * Reports, per spec file, the blocks only one test covers and the tests whose blocks are
 * a subset of another test's, from the block file that coverage-merge.mjs writes. The
 * result ranks candidates for consolidation; a reviewer still compares the assertions.
 *
 * Usage: node devops/testing/test-redundancy.mjs [--fetch] [--blocks <path>] [--map <path>]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadDevArtifact } from "./dev-artifacts.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BLOCKS_PATH = path.join(REPO_ROOT, ".cache", "test-blocks.json");
const MAP_PATH = path.join(REPO_ROOT, ".cache", "test-map.json");
const OUT_DIR = path.join(REPO_ROOT, "coverage");
const BLOCKS_HINT =
  "Build it with `npm run test:map`, or download dev's with `npm run test:redundancy -- --fetch`.";
const CAVEAT =
  "Equal coverage does not prove equal assertions: two tests can run the same code and check different results. Read both tests before you merge or delete one.";

const byLocation = (a, b) => a.localeCompare(b, "en", { numeric: true });
const specOf = (id) => id.slice(0, id.lastIndexOf(":"));

/**
 * Counts how many tests cover each block.
 * @param {Array<{blocks: Set<string>}>} tests - Tests with block sets.
 * @returns {Map<string, number>}
 */
function coverCounts(tests) {
  const counts = new Map();
  for (const { blocks } of tests) {
    for (const block of blocks) counts.set(block, (counts.get(block) || 0) + 1);
  }
  return counts;
}

/**
 * Number of blocks in a set that exactly one test covers.
 * @param {Set<string>} blocks - Blocks of one test.
 * @param {Map<string, number>} counts - Cover counts from coverCounts.
 * @returns {number}
 */
function uniqueCount(blocks, counts) {
  let unique = 0;
  for (const block of blocks) if (counts.get(block) === 1) unique++;
  return unique;
}

/**
 * Ids of the other tests whose blocks hold every block of `test`. A test with no
 * blocks is left out, because it would be a subset of every test.
 * @param {{id: string, blocks: Set<string>}} test - The test to place.
 * @param {Array<{id: string, blocks: Set<string>}>} peers - Tests of the same spec.
 * @returns {string[]}
 */
function supersetsOf(test, peers) {
  if (test.blocks.size === 0) return [];
  return peers
    .filter(
      (peer) =>
        peer.id !== test.id &&
        peer.blocks.size >= test.blocks.size &&
        [...test.blocks].every((block) => peer.blocks.has(block))
    )
    .map((peer) => peer.id);
}

/**
 * Builds the redundancy report from a block file.
 * @param {{sha: string, tests: Array<{id: string, blocks: string[]}>}} doc - Block file.
 * @param {Object<string, string>} [titles] - Test titles by id, from the test map.
 * @returns {{sha: string, specs: object[], candidates: object[]}}
 */
export function analyzeRedundancy(doc, titles = {}) {
  const tests = doc.tests.map(({ id, blocks }) => ({ id, blocks: new Set(blocks) }));
  const suiteCounts = coverCounts(tests);
  const bySpec = new Map();
  for (const test of tests) {
    const spec = specOf(test.id);
    if (!bySpec.has(spec)) bySpec.set(spec, []);
    bySpec.get(spec).push(test);
  }

  const specs = [...bySpec]
    .sort(([a], [b]) => byLocation(a, b))
    .map(([file, peers]) => {
      const specCounts = coverCounts(peers);
      return {
        file,
        tests: peers
          .sort((a, b) => byLocation(a.id, b.id))
          .map((test) => ({
            id: test.id,
            title: titles[test.id] || "",
            blocks: test.blocks.size,
            unique: uniqueCount(test.blocks, specCounts),
            suiteUnique: uniqueCount(test.blocks, suiteCounts),
            subsetOf: supersetsOf(test, peers),
          })),
      };
    });

  const candidates = specs
    .flatMap(({ file, tests: rows }) => rows.map((row) => ({ ...row, spec: file })))
    .sort(
      (a, b) =>
        a.unique - b.unique ||
        b.subsetOf.length - a.subsetOf.length ||
        a.suiteUnique - b.suiteUnique ||
        byLocation(a.id, b.id)
    );
  return { sha: doc.sha, specs, candidates };
}

const cell = (text) => String(text).replace(/\|/g, "\\|");

/**
 * One Markdown table row for a test.
 * @param {object} row - A test from the report.
 * @param {string} label - Text for the first column.
 * @returns {string}
 */
function tableRow(row, label) {
  const subsets = row.subsetOf.map((id) => `\`${id}\``).join(", ") || "";
  return `| ${cell(label)} | ${cell(row.title)} | ${row.blocks} | ${row.unique} | ${row.suiteUnique} | ${subsets} |`;
}

/**
 * Renders the report as Markdown: the zero-unique candidates, then every spec file.
 * @param {{sha: string, specs: object[], candidates: object[]}} report - From analyzeRedundancy.
 * @returns {string}
 */
export function renderMarkdown(report) {
  const header =
    "| Test | Title | Blocks | Unique in spec | Unique in suite | Subset of |\n|---|---|---:|---:|---:|---|";
  const zero = report.candidates.filter((row) => row.unique === 0);
  const lines = [
    "# Test redundancy report",
    "",
    `Block file commit: \`${String(report.sha).slice(0, 12)}\`.`,
    "",
    `> ${CAVEAT}`,
    "",
    "A block is a source segment between two V8 range boundaries. Block counts compare tests; they are not line counts.",
    "",
    "## Candidates",
    "",
    `Tests that cover no block another test in their spec misses (${zero.length} of ${report.candidates.length}), most redundant first.`,
    "",
    header,
    ...zero.map((row) => tableRow(row, `\`${row.id}\``)),
    "",
    "## By spec file",
  ];
  for (const spec of report.specs) {
    lines.push(
      "",
      `### \`${spec.file}\``,
      "",
      header,
      ...spec.tests.map((row) => tableRow(row, `\`:${row.id.slice(spec.file.length + 1)}\``))
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Reads the block file and the test map, and writes redundancy.json and redundancy.md.
 * @param {{blocksPath: string, mapPath?: string, outDir: string}} options
 * @returns {{json: string, md: string, report: object}}
 */
export function writeReport({ blocksPath, mapPath, outDir }) {
  const doc = JSON.parse(readFileSync(blocksPath, "utf-8"));
  const titles = {};
  if (mapPath && existsSync(mapPath)) {
    for (const { id, title } of JSON.parse(readFileSync(mapPath, "utf-8")).tests)
      titles[id] = title;
  }
  const report = analyzeRedundancy(doc, titles);
  mkdirSync(outDir, { recursive: true });
  const json = path.join(outDir, "redundancy.json");
  const md = path.join(outDir, "redundancy.md");
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(md, renderMarkdown(report));
  return { json, md, report };
}

/**
 * CLI entry point.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {number} Exit code.
 */
function main(argv) {
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at === -1 ? fallback : path.resolve(argv[at + 1]);
  };
  if (argv.includes("--fetch")) {
    const cacheDir = path.dirname(BLOCKS_PATH);
    for (const name of ["test-blocks", "test-map"]) {
      try {
        if (!downloadDevArtifact(name, cacheDir, REPO_ROOT)) {
          console.log(`No successful dev run has published ${name} yet.`);
        }
      } catch {
        console.log(`The latest dev run has no ${name} artifact; using the local copy if any.`);
      }
    }
  }
  const blocksPath = option("--blocks", BLOCKS_PATH);
  if (!existsSync(blocksPath)) {
    console.error(`No block file at ${path.relative(REPO_ROOT, blocksPath)}. ${BLOCKS_HINT}`);
    return 1;
  }
  const { json, md, report } = writeReport({
    blocksPath,
    mapPath: option("--map", MAP_PATH),
    outDir: OUT_DIR,
  });
  const zero = report.candidates.filter((row) => row.unique === 0).length;
  console.log(
    `${report.candidates.length} tests in ${report.specs.length} spec files; ${zero} cover no block unique in their spec.`
  );
  for (const file of [json, md]) console.log(`wrote ${path.relative(REPO_ROOT, file)}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}

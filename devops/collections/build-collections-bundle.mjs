#!/usr/bin/env node
// Builds data/collections-bundle.js from the canonical Series Template JSON
// (data/collections/index.json + each <slug>/collection.json).
//
// WHY A BUNDLE: StakTrakr runs on file:// as well as http, and Chrome refuses to
// fetch() a local JSON file there. The canonical JSON stays the public, reusable
// catalog data; this script-tag bundle is what the app actually boots from — the same
// split data/spot-history-bundle.js uses for spot history.
//
// The bundle is COMMITTED. tests/unit/collections-bundle.test.js rebuilds it in memory
// and fails when the committed file has drifted from the JSON.
//
// Usage: npm run build:collections

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COLLECTIONS_DIR = "data/collections";
const BUNDLE_PATH = "data/collections-bundle.js";

/**
 * Reads and parses one JSON file relative to the repo root.
 * @param {string} root - Repo root
 * @param {string} relativePath - Path relative to the root
 * @returns {any} Parsed JSON
 */
const readJson = (root, relativePath) => JSON.parse(readFileSync(join(root, relativePath), "utf-8"));

/**
 * Builds the bundle payload from the canonical JSON files.
 * @param {string} [root] - Repo root (defaults to this checkout)
 * @returns {{schema: number, basePath: string, index: object, templates: Object<string, object>}} Bundle payload
 */
export function buildBundleObject(root = REPO_ROOT) {
  const index = readJson(root, `${COLLECTIONS_DIR}/index.json`);
  const templates = {};
  for (const entry of index.collections) {
    const template = readJson(root, `${COLLECTIONS_DIR}/${entry.path}`);
    if (template.slug !== entry.slug) {
      throw new Error(`index.json slug "${entry.slug}" does not match ${entry.path} slug "${template.slug}"`);
    }
    templates[entry.slug] = { ...template, basePath: `${COLLECTIONS_DIR}/${dirname(entry.path)}/` };
  }
  return { schema: index.schema, basePath: `${COLLECTIONS_DIR}/`, index, templates };
}

/**
 * Renders the bundle payload as the script-tag source file.
 * @param {object} payload - Bundle payload from buildBundleObject
 * @returns {string} JavaScript source
 */
export function renderBundle(payload) {
  return [
    "// GENERATED FILE — do not edit by hand.",
    "// Source: data/collections/index.json + data/collections/<slug>/collection.json",
    "// Rebuild: npm run build:collections   (drift is caught by tests/unit/collections-bundle.test.js)",
    `window.__COLLECTIONS_BUNDLE = ${JSON.stringify(payload, null, 2)};`,
    "",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const payload = buildBundleObject();
  writeFileSync(join(REPO_ROOT, BUNDLE_PATH), renderBundle(payload));
  console.log(`[collections] wrote ${BUNDLE_PATH} — ${Object.keys(payload.templates).length} template(s)`);
}

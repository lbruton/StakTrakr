// Unit tests for the Series Template catalog data (STRK-368, epic STRK-254).
//
// Two jobs:
//   1. DRIFT GUARD — data/collections-bundle.js is a generated, committed script-tag
//      bundle (file:// cannot fetch local JSON). It must always equal what the builder
//      produces from the canonical JSON; if someone edits a collection.json without
//      running `npm run build:collections`, this fails.
//   2. TEMPLATE INTEGRITY — slot ids are the keys user links are stored under, so they
//      must be unique, storage-safe, and stable; referenced images must exist.
//
// Harness: the bundle is a script-tag global (assigns window.__COLLECTIONS_BUNDLE).
// Extract its generated JSON payload without evaluating JavaScript source.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBundleObject,
  renderBundle,
} from "../../devops/collections/build-collections-bundle.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const bundleSource = readFileSync(
  new URL("../../data/collections-bundle.js", import.meta.url),
  "utf-8"
);

function loadBundle() {
  const prefix = "window.__COLLECTIONS_BUNDLE = ";
  const start = bundleSource.indexOf(prefix);
  assert.notEqual(start, -1, "bundle assignment is missing");
  const json = bundleSource
    .slice(start + prefix.length)
    .trim()
    .replace(/;$/, "");
  return JSON.parse(json);
}

const bundle = loadBundle();
const templates = Object.values(bundle.templates);

describe("collections bundle — drift guard", () => {
  test("the committed bundle equals a fresh build from the canonical JSON", () => {
    assert.deepEqual(bundle, buildBundleObject(REPO_ROOT));
  });

  test("the committed file is byte-identical to the builder's output", () => {
    assert.equal(bundleSource, renderBundle(buildBundleObject(REPO_ROOT)));
  });

  test("every index entry resolves to a template with a matching slug", () => {
    assert.ok(bundle.index.collections.length > 0);
    for (const entry of bundle.index.collections) {
      assert.equal(bundle.templates[entry.slug].slug, entry.slug);
    }
  });

  test("the builder rejects duplicate index slugs before replacing a template", () => {
    const root = mkdtempSync(join(tmpdir(), "staktrakr-collections-"));
    try {
      const collectionsDir = join(root, "data", "collections");
      for (const directory of ["first", "second"]) {
        mkdirSync(join(collectionsDir, directory), { recursive: true });
        writeFileSync(
          join(collectionsDir, directory, "collection.json"),
          JSON.stringify({ slug: "shared", name: directory })
        );
      }
      writeFileSync(
        join(collectionsDir, "index.json"),
        JSON.stringify({
          schema: 1,
          collections: [
            { slug: "shared", path: "first/collection.json" },
            { slug: "shared", path: "second/collection.json" },
          ],
        })
      );
      assert.throws(() => buildBundleObject(root), /index\.json contains duplicate slug "shared"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("series templates — integrity", () => {
  test("slot ids are unique and storage-safe", () => {
    for (const template of templates) {
      const ids = template.slots.map((slot) => slot.id);
      assert.equal(new Set(ids).size, ids.length, `${template.slug}: duplicate slot id`);
      for (const id of ids)
        assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${template.slug}: unsafe slot id "${id}"`);
    }
  });

  test("slots run in ascending year order and carry a label", () => {
    for (const template of templates) {
      const years = template.slots.map((slot) => slot.year);
      assert.deepEqual(
        years,
        [...years].sort((a, b) => a - b),
        `${template.slug}: slots out of order`
      );
      for (const slot of template.slots)
        assert.ok(String(slot.label).length > 0, `${template.slug}/${slot.id}: no label`);
    }
  });

  test("mintage is a positive integer, or null with a non-final status", () => {
    for (const template of templates) {
      for (const slot of template.slots) {
        const where = `${template.slug}/${slot.id}`;
        assert.ok(
          ["final", "reported", "in-production"].includes(slot.mintageStatus),
          `${where}: bad mintageStatus`
        );
        if (slot.mintage === null) {
          assert.equal(
            slot.mintageStatus,
            "in-production",
            `${where}: null mintage must be in-production`
          );
        } else {
          assert.ok(Number.isInteger(slot.mintage) && slot.mintage > 0, `${where}: bad mintage`);
        }
      }
    }
  });

  test("referenced stock images exist on disk", () => {
    for (const template of templates) {
      for (const side of ["obverse", "reverse"]) {
        const file = `${REPO_ROOT}${template.basePath}${template.images[side]}`;
        assert.ok(existsSync(file), `${template.slug}: missing ${side} image at ${file}`);
      }
    }
  });

  test("every template names the fields the Add Item prefill and suggestions rely on", () => {
    for (const template of templates) {
      assert.ok(
        template.name && template.metal && template.itemType,
        `${template.slug}: missing identity fields`
      );
      assert.ok(template.weight > 0 && template.weightUnit, `${template.slug}: missing weight`);
      assert.ok(
        Array.isArray(template.match.names) && template.match.names.length > 0,
        `${template.slug}: no match names`
      );
      assert.ok(
        template.itemDefaults.name.includes("{year}"),
        `${template.slug}: itemDefaults.name needs {year}`
      );
      assert.ok(
        Array.isArray(template.sources) && template.sources.length > 0,
        `${template.slug}: uncited template`
      );
    }
  });

  test("ASE Type 2 pins the verified 2021 split and the slot list", () => {
    const ase = bundle.templates["ase-type2"];
    assert.deepEqual(
      ase.slots.map((slot) => slot.id),
      ["2021-t2", "2022", "2023", "2024", "2025", "2026"]
    );
    assert.equal(ase.slots[0].mintage, 14968500);
    assert.equal(ase.retailSlug, "ase");
    assert.ok(ase.slots[0].hints.reject.includes("type 1"));
  });

  test("ASE Type 1 pins the 1986 to 2021 slot list and the verified 2021 split", () => {
    const ase = bundle.templates["ase-type1"];
    const expectedIds = [];
    for (let year = 1986; year <= 2020; year++) expectedIds.push(String(year));
    expectedIds.push("2021-t1");
    assert.deepEqual(
      ase.slots.map((slot) => slot.id),
      expectedIds
    );
    assert.equal(ase.slots.length, 36);
    const last = ase.slots[ase.slots.length - 1];
    assert.equal(last.mintage, 13306500);
    assert.equal(ase.slots[0].mintage, 5096000);
    assert.equal(ase.retailSlug, "ase");
    assert.deepEqual(ase.run, { start: 1986, end: 2021 });
    assert.ok(last.hints.prefer.includes("type 1"));
    assert.ok(last.hints.reject.includes("type 2"));
    // The two 2021 Slots must add up to the Mint's single 2021 sales total.
    assert.equal(last.mintage + bundle.templates["ase-type2"].slots[0].mintage, 28275000);
  });
});

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
// Harness: the bundle is a script-tag global (assigns window.__COLLECTIONS_BUNDLE), so
// it is evaluated with a mock `window`, mirroring the other script-global unit tests.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  const surface = {};
  new Function("window", bundleSource)(surface);
  return surface.__COLLECTIONS_BUNDLE;
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
});

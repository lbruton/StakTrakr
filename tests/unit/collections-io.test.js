// Unit tests for the CSV "Collections" cell grammar (STRK-371, epic STRK-254).
//
// js/collections-io.js encodes one Item's memberships as "collectionId:slotId[:spare]" pairs,
// semicolon-joined like Tags. These tests ENCODE that grammar and the apply rules:
//
//   Round trip   — parseMembershipCell(membershipCell(uuid)) reproduces slot and role.
//   Tolerance    — a hand-edited cell (stray spaces, empty pairs, junk) never throws and
//                  never yields a half-formed membership. PapaParse can leave a trailing
//                  "\r" on the last column, so whitespace trimming is load-bearing.
//   Safety       — an id containing a separator is left out of the cell rather than
//                  written in a form that would parse back as a different membership.
//   Apply order  — primaries land before spares, and a primary whose seat is taken
//                  becomes a spare instead of being dropped.
//
// Harness: script-tag IIFEs evaluated through `new Function` (see collections-store.test.js).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../../js/${name}`, import.meta.url), "utf-8");
const coreSrc = read("collections-core.js");
const storeSrc = read("collections-store.js");
const ioSrc = read("collections-io.js");

const TEMPLATE = "ase-type2";
const U = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
};

/**
 * Builds an isolated core + store + io stack over an in-memory storage double.
 * @returns {{io: Object, store: Object}} Harness
 */
function makeHarness() {
  const surface = {};
  new Function("window", coreSrc)(surface);
  surface.__COLLECTIONS_BUNDLE = { templates: { [TEMPLATE]: { slug: TEMPLATE, slots: [] } } };

  const disk = new Map();
  const inventory = [{ uuid: U.a }, { uuid: U.b }];
  disk.set("metalInventory", JSON.stringify(inventory));
  const documentDouble = { dispatchEvent: () => true, getElementById: () => null };
  class CustomEventDouble {
    constructor(type) {
      this.type = type;
    }
  }

  new Function(
    "window",
    "document",
    "CustomEvent",
    "saveDataSync",
    "loadDataSync",
    "COLLECTION_STATE_KEY",
    "DISABLED_COLLECTIONS_KEY",
    "LS_KEY",
    "inventory",
    "generateUUID",
    "saveInventory",
    storeSrc
  )(
    surface,
    documentDouble,
    CustomEventDouble,
    (key, value) => disk.set(key, JSON.stringify(value)),
    (key, fallback) => (disk.has(key) ? JSON.parse(disk.get(key)) : fallback),
    "collectionState",
    "disabledCollections",
    "metalInventory",
    inventory,
    () => "00000000-0000-4000-8000-000000000001",
    () => undefined
  );
  new Function("window", "document", "debugLog", ioSrc)(surface, documentDouble, () => undefined);

  return { io: surface.collectionsIO, store: surface.collectionsStore };
}

describe("collections io — CSV Collections cell (STRK-371)", () => {
  test("a primary and a spare round-trip through the cell", () => {
    const h = makeHarness();
    h.store.link(TEMPLATE, "2024", U.a);
    h.store.link(TEMPLATE, "2024", U.b, { asSpare: true });

    assert.equal(h.io.membershipCell(U.a), "ase-type2:2024");
    assert.equal(h.io.membershipCell(U.b), "ase-type2:2024:spare");
    assert.deepEqual(h.io.parseMembershipCell(h.io.membershipCell(U.b)), [
      { collectionId: TEMPLATE, slotId: "2024", asSpare: true },
    ]);
  });

  test("an Item in no Collection, or an unknown uuid, yields an empty cell", () => {
    const h = makeHarness();

    assert.equal(h.io.membershipCell(U.a), "");
    assert.equal(h.io.membershipCell(""), "");
  });

  test("a hand-edited cell is parsed leniently and never yields a half-formed membership", () => {
    const h = makeHarness();

    assert.deepEqual(h.io.parseMembershipCell("  ase-type2 : 2024 ;; morgans:1881-cc:spare\r"), [
      { collectionId: "ase-type2", slotId: "2024", asSpare: false },
      { collectionId: "morgans", slotId: "1881-cc", asSpare: true },
    ]);
    assert.deepEqual(h.io.parseMembershipCell("no-separator; :2024; ase-type2:"), []);
    assert.deepEqual(h.io.parseMembershipCell(undefined), []);
  });

  test("an id containing a separator is left out of the cell", () => {
    const h = makeHarness();
    h.store.link(TEMPLATE, "20:24", U.a);

    assert.equal(h.io.membershipCell(U.a), "");
  });

  test("applyMemberships links primaries before spares regardless of row order", () => {
    const h = makeHarness();

    const written = h.io.applyMemberships([
      { uuid: U.b, entries: [{ collectionId: TEMPLATE, slotId: "2024", asSpare: true }] },
      { uuid: U.a, entries: [{ collectionId: TEMPLATE, slotId: "2024", asSpare: false }] },
    ]);

    assert.equal(written, 2);
    const slot = h.store.getState().collections[TEMPLATE].slots["2024"];
    assert.equal(slot.primary, U.a);
    assert.deepEqual([...slot.spares], [U.b]);
  });

  test("a primary whose slot is already taken becomes a spare instead of being dropped", () => {
    const h = makeHarness();
    h.store.link(TEMPLATE, "2024", U.a);

    const written = h.io.applyMemberships([
      { uuid: U.b, entries: [{ collectionId: TEMPLATE, slotId: "2024", asSpare: false }] },
    ]);

    assert.equal(written, 1);
    const slot = h.store.getState().collections[TEMPLATE].slots["2024"];
    assert.equal(slot.primary, U.a);
    assert.deepEqual([...slot.spares], [U.b]);
  });

  test("a membership naming an unknown Custom Collection is skipped, not invented", () => {
    const h = makeHarness();

    const written = h.io.applyMemberships([
      { uuid: U.a, entries: [{ collectionId: "custom-missing", slotId: "s1", asSpare: false }] },
    ]);

    assert.equal(written, 0);
    assert.equal(h.store.getState().collections["custom-missing"], undefined);
  });

  test("importFile's payload guard: mergeState ignores a non-object", () => {
    const h = makeHarness();

    assert.deepEqual(h.io.mergeState(null), { ok: true, changed: false });
    assert.deepEqual(h.io.mergeState("nope"), { ok: true, changed: false });
  });
});

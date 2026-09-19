// Unit tests for the Collections store's write-failure contract (STRK-377, epic STRK-254).
//
// js/collections-store.js runs a core mutation against the live in-memory state and THEN
// persists it. These tests ENCODE the transaction contract for that seam:
//
//   Atomicity   — when the storage write throws (quota), the in-memory state is equivalent
//                 to its pre-mutation value: no half-applied link, no newly started
//                 Collection, no merged-in state.
//   Honesty     — the failed operation reports ok:false / reason:"save-failed" and does NOT
//                 fire the "collections:changed" success event.
//   No leakage  — a later successful mutation persists only itself, never any part of the
//                 earlier failed operation.
//
// Harness: the store is a script-tag IIFE with free-variable dependencies (saveDataSync,
// loadDataSync, inventory, document, ...). Mirroring collections-core.test.js, the file is
// evaluated through `new Function`, which turns those globals into injectable parameters.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const coreSrc = readFileSync(new URL("../../js/collections-core.js", import.meta.url), "utf-8");
const storeSrc = readFileSync(new URL("../../js/collections-store.js", import.meta.url), "utf-8");

const STATE_KEY = "collectionState";
const INVENTORY_KEY = "metalInventory";
const TEMPLATE = "ase-type2";

const U = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
};

// The state uses null-prototype maps by design; compare logical content only.
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Builds an isolated store over an in-memory storage double.
 * @param {Object} [seedState] - Collections state persisted before the store loads
 * @returns {{store: Object, core: Object, disk: Map, events: string[], failNextWrite: Function}} Harness
 */
function makeHarness(seedState) {
  const surface = {};
  new Function("window", coreSrc)(surface);
  surface.__COLLECTIONS_BUNDLE = {
    templates: { [TEMPLATE]: { slug: TEMPLATE, name: "American Silver Eagle", slots: [] } },
  };

  const disk = new Map();
  const inventory = [{ uuid: U.a }, { uuid: U.b }];
  disk.set(INVENTORY_KEY, JSON.stringify(inventory));
  if (seedState) disk.set(STATE_KEY, JSON.stringify(seedState));

  let failuresArmed = 0;
  const saveDataSync = (key, value) => {
    if (key === STATE_KEY && failuresArmed > 0) {
      failuresArmed -= 1;
      throw new Error("QuotaExceededError (injected)");
    }
    disk.set(key, JSON.stringify(value));
  };
  const loadDataSync = (key, fallback) =>
    disk.has(key) ? JSON.parse(disk.get(key)) : fallback === undefined ? [] : fallback;

  const events = [];
  const documentDouble = {
    dispatchEvent: (event) => events.push(event.type),
    getElementById: () => null,
  };
  class CustomEventDouble {
    constructor(type) {
      this.type = type;
    }
  }

  let minted = 0;
  new Function(
    "window",
    "document",
    "CustomEvent",
    "saveDataSync",
    "loadDataSync",
    "COLLECTION_STATE_KEY",
    "LS_KEY",
    "inventory",
    "generateUUID",
    "saveInventory",
    storeSrc
  )(
    surface,
    documentDouble,
    CustomEventDouble,
    saveDataSync,
    loadDataSync,
    STATE_KEY,
    INVENTORY_KEY,
    inventory,
    () => `00000000-0000-4000-8000-00000000000${(minted += 1)}`,
    () => undefined
  );

  return {
    store: surface.collectionsStore,
    core: surface.collectionsCore,
    disk,
    events,
    failNextWrite: () => {
      failuresArmed += 1;
    },
  };
}

/** Persisted Collections state, or null when nothing was ever written. */
const persisted = (disk) => (disk.has(STATE_KEY) ? JSON.parse(disk.get(STATE_KEY)) : null);

/** A harness whose template collection already holds U.a in slot 2023. */
function startedHarness() {
  const boot = makeHarness();
  assert.equal(boot.store.link(TEMPLATE, "2023", U.a).ok, true);
  return makeHarness(persisted(boot.disk));
}

describe("collections store — failed storage write (STRK-377)", () => {
  test("first link: a failed write leaves no started Collection and no link behind", () => {
    const h = makeHarness();
    const before = plain(h.store.getState());
    h.failNextWrite();

    const result = h.store.link(TEMPLATE, "2024", U.a);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "save-failed");
    assert.deepEqual(plain(h.store.getState()), before);
    assert.equal(h.store.getState().collections[TEMPLATE], undefined);
    assert.deepEqual(h.events, []);
  });

  test("link into a started Collection: a failed write rolls the slot back", () => {
    const h = startedHarness();
    const before = plain(h.store.getState());
    h.failNextWrite();

    const result = h.store.link(TEMPLATE, "2024", U.b);

    assert.equal(result.reason, "save-failed");
    assert.deepEqual(plain(h.store.getState()), before);
    assert.deepEqual(h.store.memberships(U.b), []);
    assert.deepEqual(h.events, []);
  });

  test("unlink: a failed write keeps the item linked", () => {
    const h = startedHarness();
    const before = plain(h.store.getState());
    h.failNextWrite();

    const result = h.store.unlink(TEMPLATE, "2023", U.a);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "save-failed");
    assert.deepEqual(plain(h.store.getState()), before);
    assert.equal(h.store.getState().collections[TEMPLATE].slots["2023"].primary, U.a);
    assert.deepEqual(h.events, []);
  });

  test("createCustom: a failed write leaves no Custom Collection in memory", () => {
    const h = makeHarness();
    const before = plain(h.store.getState());
    h.failNextWrite();

    const result = h.store.createCustom({ name: "Type set", slots: [{ label: "Morgan" }] });

    assert.deepEqual(result, { ok: false, reason: "save-failed" });
    assert.deepEqual(plain(h.store.getState()), before);
    assert.deepEqual(h.events, []);
  });

  test("updateCustom: a failed write keeps the prior definition", () => {
    const h = makeHarness();
    const created = h.store.createCustom({ name: "Type set", slots: [{ label: "Morgan" }] });
    assert.equal(created.ok, true);
    const id = created.collection.id;
    const before = plain(h.store.getState());
    h.events.length = 0;
    h.failNextWrite();

    const result = h.store.updateCustom(id, {
      name: "Renamed",
      slots: [{ label: "Morgan" }, { label: "Peace" }],
    });

    assert.equal(result.reason, "save-failed");
    assert.deepEqual(plain(h.store.getState()), before);
    assert.equal(h.store.getState().collections[id].name, "Type set");
    assert.deepEqual(h.events, []);
  });

  test("mergeIn: a failed write discards the merged state", () => {
    const donor = makeHarness();
    donor.store.link(TEMPLATE, "2024", U.b);
    const incoming = persisted(donor.disk);

    const h = startedHarness();
    const before = plain(h.store.getState());
    h.failNextWrite();

    const result = h.store.mergeIn(incoming);

    assert.deepEqual(result, { ok: false, changed: false, reason: "save-failed" });
    assert.deepEqual(plain(h.store.getState()), before);
    assert.deepEqual(h.store.memberships(U.b), []);
    assert.deepEqual(h.events, []);
  });

  test("a later successful mutation cannot persist any part of the failed one", () => {
    const h = startedHarness();
    h.failNextWrite();
    assert.equal(h.store.link(TEMPLATE, "2024", U.b).reason, "save-failed");

    const created = h.store.createCustom({ name: "Type set", slots: [{ label: "Morgan" }] });

    assert.equal(created.ok, true);
    const onDisk = persisted(h.disk);
    assert.equal(onDisk.collections[TEMPLATE].slots["2024"], undefined);
    assert.equal(onDisk.collections[TEMPLATE].slots["2023"].primary, U.a);
    assert.ok(onDisk.collections[created.collection.id]);
    assert.deepEqual(h.events, ["collections:changed"]);
  });

  test("rolled-back state keeps its null-prototype maps", () => {
    const h = startedHarness();
    h.failNextWrite();
    h.store.link(TEMPLATE, "2024", U.b);

    const state = h.store.getState();

    assert.equal(Object.getPrototypeOf(state.collections), null);
    assert.equal(Object.getPrototypeOf(state.collections[TEMPLATE].slots), null);
  });

  test("the success path still persists and announces exactly once", () => {
    const h = makeHarness();

    const result = h.store.link(TEMPLATE, "2024", U.a);

    assert.equal(result.ok, true);
    assert.equal(persisted(h.disk).collections[TEMPLATE].slots["2024"].primary, U.a);
    assert.deepEqual(h.events, ["collections:changed"]);
  });
});

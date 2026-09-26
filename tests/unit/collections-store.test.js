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
const DISABLED_KEY = "disabledCollections";
const INVENTORY_KEY = "metalInventory";
const TEMPLATE = "ase-type2";
const T1 = "2026-09-18T10:00:00.000Z";

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
function makeHarness(seedState, options = {}) {
  const surface = {};
  new Function("window", coreSrc)(surface);
  surface.__COLLECTIONS_BUNDLE = {
    templates: { [TEMPLATE]: { slug: TEMPLATE, name: "American Silver Eagle", slots: [] } },
  };

  const disk = new Map();
  const inventory = [{ uuid: U.a }, { uuid: U.b }, { uuid: "disposed-item", disposed: true }];
  disk.set(INVENTORY_KEY, JSON.stringify(inventory));
  if (seedState) disk.set(STATE_KEY, JSON.stringify(seedState));
  if (Object.prototype.hasOwnProperty.call(options, "disabledCollections")) {
    disk.set(DISABLED_KEY, JSON.stringify(options.disabledCollections));
  }

  let failuresArmed = 0;
  let failedKey = STATE_KEY;
  const saveDataSync = (key, value) => {
    if (key === failedKey && failuresArmed > 0) {
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
    "DISABLED_COLLECTIONS_KEY",
    "LS_KEY",
    "inventory",
    "isDisposed",
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
    DISABLED_KEY,
    INVENTORY_KEY,
    inventory,
    (item) => Boolean(item && item.disposed),
    () => `00000000-0000-4000-8000-00000000000${(minted += 1)}`,
    () => undefined
  );

  return {
    store: surface.collectionsStore,
    core: surface.collectionsCore,
    disk,
    events,
    failNextWrite: (key = STATE_KEY) => {
      failedKey = key;
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
  test("a CSV membership batch saves once and rolls back every link on quota failure", () => {
    const h = makeHarness();
    const pending = [
      { uuid: U.a, entry: { collectionId: TEMPLATE, slotId: "2023", asSpare: false } },
      { uuid: U.b, entry: { collectionId: TEMPLATE, slotId: "2024", asSpare: false } },
    ];
    h.failNextWrite();
    const failed = h.store.linkMemberships(pending);
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, "save-failed");
    assert.equal(h.store.getState().collections[TEMPLATE], undefined);
    assert.deepEqual(h.events, []);

    const retried = h.store.linkMemberships(pending);
    assert.equal(retried.count, 2);
    assert.deepEqual(h.events, ["collections:changed"]);
    assert.equal(persisted(h.disk).collections[TEMPLATE].slots["2024"].primary, U.b);
  });
  test("first link: a failed write leaves no started Collection and no link behind", () => {
    const h = makeHarness();
    const before = plain(h.store.getState());
    h.failNextWrite();

    const result = h.store.link(TEMPLATE, "2024", U.a);

    assert.equal(result.ok, false);
    assertWriteRolledBack(result, h, before);
    assert.equal(h.store.getState().collections[TEMPLATE], undefined);
  });

  /**
   * Every failed-write case asserts the same rollback contract: the reason is
   * reported, the state is byte-identical to the snapshot, and no event escapes.
   * @param {object} result - The store call's result object.
   * @param {object} h - The harness under test.
   * @param {object} before - plain() snapshot taken before the failing write.
   */
  const assertWriteRolledBack = (result, h, before) => {
    assert.equal(result.reason, "save-failed");
    assert.deepEqual(plain(h.store.getState()), before);
    assert.deepEqual(h.events, []);
  };

  test("link into a started Collection: a failed write rolls the slot back", () => {
    const h = startedHarness();
    const before = plain(h.store.getState());
    h.failNextWrite();

    const result = h.store.link(TEMPLATE, "2024", U.b);

    assertWriteRolledBack(result, h, before);
    assert.deepEqual(h.store.memberships(U.b), []);
  });

  test("unlink: a failed write keeps the item linked", () => {
    const h = startedHarness();
    const before = plain(h.store.getState());
    h.failNextWrite();

    const result = h.store.unlink(TEMPLATE, "2023", U.a);

    assert.equal(result.ok, false);
    assertWriteRolledBack(result, h, before);
    assert.equal(h.store.getState().collections[TEMPLATE].slots["2023"].primary, U.a);
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

describe("collections store — disabled Collections preference (STRK-393)", () => {
  test("normalizes missing, malformed, duplicate, and unknown disabled IDs", () => {
    const missing = makeHarness();
    assert.deepEqual(missing.store.getDisabledIds(), []);

    for (const malformed of [null, "ase-type2", 7, {}]) {
      const h = makeHarness(undefined, { disabledCollections: malformed });
      assert.deepEqual(h.store.getDisabledIds(), []);
    }

    const mixed = makeHarness(undefined, {
      disabledCollections: ["ase-type2", "", null, 4, "future-template", "ase-type2", "  "],
    });
    assert.deepEqual(mixed.store.getDisabledIds(), ["ase-type2", "future-template"]);
    assert.equal(mixed.store.isEnabled("future-template"), false);
    assert.equal(mixed.store.isEnabled("new-series-template"), true);
  });

  test("linkedItemIds returns unique raw primary and Spare IDs, including disposed and unresolved Items", () => {
    const h = makeHarness();
    assert.equal(h.store.link(TEMPLATE, "2024", U.a).ok, true);
    assert.equal(h.store.link(TEMPLATE, "2024", "disposed-item", { asSpare: true }).ok, true);
    assert.equal(h.store.link(TEMPLATE, "2024", "missing-item", { asSpare: true }).ok, true);

    // Simulate a legacy/corrupt duplicate reference. Occupancy must count it once.
    h.store.getState().collections[TEMPLATE].slots["2023"] = {
      primary: U.a,
      spares: ["disposed-item", "missing-item"],
      modified: T1,
    };

    assert.deepEqual(h.store.linkedItemIds(TEMPLATE), [U.a, "disposed-item", "missing-item"]);
  });

  test("a missing template record and artwork-only Custom Collection have no linked Items", () => {
    const h = makeHarness();
    assert.deepEqual(h.store.linkedItemIds(TEMPLATE), []);

    const created = h.store.createCustom({ name: "Artwork only", slots: [{ label: "One" }] });
    assert.equal(created.ok, true);
    assert.equal(h.store.setArtwork(created.collection.id, null, true, T1).ok, true);
    assert.deepEqual(h.store.linkedItemIds(created.collection.id), []);
  });

  test("disabling an empty unstarted template persists its ID without changing Collection state", () => {
    const h = makeHarness();
    const stateBefore = h.disk.get(STATE_KEY) || null;

    const result = h.store.setEnabled(TEMPLATE, false);

    assert.equal(result.ok, true);
    assert.deepEqual(h.store.getDisabledIds(), [TEMPLATE]);
    assert.equal(h.store.isEnabled(TEMPLATE), false);
    assert.equal(h.disk.get(STATE_KEY) || null, stateBefore);
  });

  test("refuses to disable a populated Collection and reports its unique primary plus Spare count", () => {
    const h = makeHarness(undefined, { disabledCollections: ["future-template"] });
    assert.equal(h.store.link(TEMPLATE, "2024", U.a).ok, true);
    assert.equal(h.store.link(TEMPLATE, "2024", U.b, { asSpare: true }).ok, true);
    const preferenceBefore = h.disk.get(DISABLED_KEY);

    const result = h.store.setEnabled(TEMPLATE, false);

    assert.deepEqual(result, { ok: false, reason: "populated", linkedCount: 2 });
    assert.equal(h.disk.get(DISABLED_KEY), preferenceBefore);
    assert.deepEqual(h.store.getDisabledIds(), ["future-template"]);
  });

  test("effective visibility remains On for a populated disabled ID before cleanup", () => {
    const h = makeHarness();
    assert.equal(h.store.link(TEMPLATE, "2024", U.a).ok, true);
    // Restore a stale on-disk preference after link()'s save hook has reconciled it.
    h.disk.set(DISABLED_KEY, JSON.stringify([TEMPLATE]));

    assert.equal(h.store.isEnabled(TEMPLATE), true);
  });

  test("re-enabling preserves the Collection's stored Slot artwork", () => {
    const h = makeHarness(undefined, { disabledCollections: [] });
    const created = h.store.createCustom({ name: "Art returns", slots: [{ label: "One" }] });
    const id = created.collection.id;
    assert.equal(h.store.setArtwork(id, "one", true, T1).ok, true);
    assert.equal(h.store.setEnabled(id, false).ok, true);

    const enabled = h.store.setEnabled(id, true);

    assert.equal(enabled.ok, true);
    assert.equal(h.store.isEnabled(id), true);
    assert.equal(h.store.getState().collections[id].artwork["slot:one"].present, true);
  });

  test("a failed preference write returns ok:false and leaves the previous list authoritative", () => {
    const h = makeHarness(undefined, { disabledCollections: ["future-template"] });
    const before = h.disk.get(DISABLED_KEY);
    h.failNextWrite(DISABLED_KEY);

    const result = h.store.setEnabled(TEMPLATE, false);

    assert.equal(result.ok, false);
    assert.equal(h.disk.get(DISABLED_KEY), before);
    assert.deepEqual(h.store.getDisabledIds(), ["future-template"]);
  });

  test("reconcilePopulated removes populated IDs silently and is idempotent", () => {
    const h = makeHarness(undefined, { disabledCollections: [TEMPLATE] });
    assert.equal(h.store.link(TEMPLATE, "2024", U.a).ok, true);
    h.events.length = 0;

    h.store.reconcilePopulated();
    h.store.reconcilePopulated();

    assert.deepEqual(h.store.getDisabledIds(), []);
    assert.equal(h.events.includes("toast"), false);
    assert.equal(h.events.includes("modal"), false);
  });

  test("mergeIn and reload reconcile populated IDs without opening the Settings panel", () => {
    const donor = makeHarness();
    assert.equal(donor.store.link(TEMPLATE, "2024", U.a).ok, true);
    const incoming = persisted(donor.disk);

    const merged = makeHarness(undefined, { disabledCollections: [TEMPLATE] });
    assert.equal(merged.store.mergeIn(incoming).ok, true);
    assert.deepEqual(merged.store.getDisabledIds(), []);

    const reloaded = makeHarness(undefined, { disabledCollections: [TEMPLATE] });
    reloaded.disk.set(STATE_KEY, JSON.stringify(incoming));
    reloaded.store.reload();
    assert.deepEqual(reloaded.store.getDisabledIds(), []);
  });

  test("mergeIn can defer populated reconciliation until the caller commits", () => {
    const donor = makeHarness();
    assert.equal(donor.store.link(TEMPLATE, "2024", U.a).ok, true);
    const incoming = persisted(donor.disk);

    const merged = makeHarness(undefined, { disabledCollections: [TEMPLATE] });
    const result = merged.store.mergeIn(incoming, { deferReconcile: true });

    assert.equal(result.ok, true);
    assert.deepEqual(merged.store.getDisabledIds(), [TEMPLATE]);
    assert.deepEqual(merged.events, ["collections:changed"]);

    merged.store.reload();
    assert.deepEqual(merged.store.getDisabledIds(), []);
    assert.deepEqual(merged.events, ["collections:changed", "collections:changed"]);
  });
});

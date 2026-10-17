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
  // Window listeners the store registers (STRK-440 cross-tab `storage` listener).
  const windowListeners = Object.create(null);
  surface.addEventListener = (type, listener) => {
    (windowListeners[type] ||= []).push(listener);
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
  // Mirrors js/utils.js loadDataSync: an absent key AND an unparsable value both yield
  // the fallback, so only localStorage.getItem can tell the two apart.
  const loadDataSync = (key, fallback) => {
    const missing = fallback === undefined ? [] : fallback;
    if (!disk.has(key)) return missing;
    try {
      return JSON.parse(disk.get(key));
    } catch {
      return missing;
    }
  };
  const localStorageDouble = { getItem: (key) => (disk.has(key) ? disk.get(key) : null) };

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
    "localStorage",
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
    () => undefined,
    localStorageDouble
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
    /** Delivers a `storage` event, as the browser does after ANOTHER tab writes `key`. */
    fireStorage: (key) => (windowListeners.storage || []).forEach((listener) => listener({ key })),
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

// STRK-439: the store hydrates once and has no cross-tab listener, so callers that must
// judge artwork ownership against what another tab persisted read a private snapshot.
describe("readPersisted — fail-closed snapshot of the stored Collections state", () => {
  const T2 = "2026-09-19T10:00:00.000Z";

  /** A harness holding one Custom Collection whose Slot "one" has artwork stamped at T1. */
  const artworkHarness = () => {
    const h = makeHarness();
    const id = h.store.createCustom({ name: "Second tab", slots: [{ label: "One" }] }).collection
      .id;
    assert.equal(h.store.setArtwork(id, "one", true, T1, "digest-a").ok, true);
    h.events.length = 0;
    return { ...h, id };
  };

  /** Rewrites the persisted state the way another tab's save would. */
  const rewriteDisk = (h, mutate) => {
    const raw = JSON.parse(h.disk.get(STATE_KEY));
    mutate(raw);
    h.disk.set(STATE_KEY, JSON.stringify(raw));
  };

  test("an absent key reads as an empty state, not as unreadable", () => {
    const h = makeHarness();
    const snapshot = h.store.readPersisted();
    assert.notEqual(snapshot, null);
    assert.deepEqual(Object.keys(snapshot.collections), []);
  });

  test("returns what another tab persisted without touching memory or firing events", () => {
    const h = artworkHarness();
    rewriteDisk(h, (raw) => {
      raw.collections[h.id].artwork["slot:one"] = {
        present: true,
        modified: T2,
        digest: "digest-b",
      };
    });

    const snapshot = h.store.readPersisted();

    assert.equal(snapshot.collections[h.id].artwork["slot:one"].digest, "digest-b");
    assert.equal(h.store.getState().collections[h.id].artwork["slot:one"].digest, "digest-a");
    assert.deepEqual(h.events, []);
    assert.equal(
      h.core.isCurrentArtwork(snapshot, `collection--${h.id}--one`, Date.parse(T2), "digest-b"),
      true
    );
  });

  test("an unparsable value is unreadable (null), never an empty state", () => {
    const h = artworkHarness();
    h.disk.set(STATE_KEY, "{not json");
    assert.equal(h.store.readPersisted(), null);
  });

  for (const [label, value] of [
    ["is an array", []],
    ["has no collections map", {}],
    ["has an array for collections", { collections: [] }],
  ]) {
    test(`a persisted value that ${label} is unreadable (null)`, () => {
      const h = artworkHarness();
      h.disk.set(STATE_KEY, JSON.stringify(value));
      assert.equal(h.store.readPersisted(), null);
    });
  }

  for (const [label, entry] of [
    ["a non-boolean present", { present: "true", modified: T2, digest: "" }],
    ["a non-canonical modified", { present: true, modified: "2026-09-19T10:00:00Z", digest: "" }],
    // Normalization DROPS these entries, and isCurrentArtwork reads a missing entry as
    // pre-stamp art (current), so a damaged removal tombstone would revive stale art.
    ["a missing modified", { present: false, digest: "" }],
    ["an empty modified", { present: false, modified: "", digest: "" }],
    ["a non-string modified", { present: false, modified: 1760000000000, digest: "" }],
    ["a null entry", null],
    ["a string entry", "present"],
  ]) {
    test(`a stamp with ${label} makes the snapshot unreadable (null)`, () => {
      const h = artworkHarness();
      rewriteDisk(h, (raw) => {
        raw.collections[h.id].artwork["slot:one"] = entry;
      });
      assert.equal(h.store.readPersisted(), null);
    });
  }

  test("a Collection entry that normalization would drop makes the snapshot unreadable (null)", () => {
    const h = artworkHarness();
    rewriteDisk(h, (raw) => {
      raw.collections["damaged-entry"] = 42;
    });
    assert.equal(h.store.readPersisted(), null);
  });
});

// STRK-440: another tab's write reaches this tab only as a `storage` event. Without a
// listener this tab keeps a stale copy: its next save overwrites the other tab's work and
// its exports judge artwork against old stamps.
describe("cross-tab storage listener (STRK-440)", () => {
  /**
   * This tab (h) and another tab that links U.b to Slot 2024 and persists it.
   * @returns {Object} Harness for this tab, after the other tab's write landed on disk
   */
  const afterOtherTabLinks = () => {
    const h = startedHarness();
    h.store.getState(); // hydrate this tab BEFORE the other tab writes (hydration is lazy)
    const other = makeHarness(persisted(h.disk));
    assert.equal(other.store.link(TEMPLATE, "2024", U.b).ok, true);
    h.disk.set(STATE_KEY, other.disk.get(STATE_KEY));
    h.events.length = 0;
    return h;
  };

  test("another tab's write re-hydrates memory and announces a repaint", () => {
    const h = afterOtherTabLinks();
    assert.equal(h.store.getState().collections[TEMPLATE].slots["2024"], undefined);

    h.fireStorage(STATE_KEY);

    assert.equal(h.store.getState().collections[TEMPLATE].slots["2024"].primary, U.b);
    assert.ok(h.events.includes("collections:changed"));
  });

  test("this tab's next mutation keeps the other tab's link", () => {
    const h = afterOtherTabLinks();
    h.fireStorage(STATE_KEY);

    assert.equal(h.store.createCustom({ name: "Mine", slots: [{ label: "One" }] }).ok, true);

    const disk = persisted(h.disk);
    assert.equal(disk.collections[TEMPLATE].slots["2024"].primary, U.b);
    assert.equal(disk.collections[TEMPLATE].slots["2023"].primary, U.a);
    assert.ok(Object.values(disk.collections).some((entry) => entry.name === "Mine"));
  });

  test("a write to an unrelated key leaves memory alone and stays quiet", () => {
    const h = afterOtherTabLinks();

    h.fireStorage(INVENTORY_KEY);

    assert.equal(h.store.getState().collections[TEMPLATE].slots["2024"], undefined);
    assert.deepEqual(h.events, []);
  });

  test("a storage clear (null key) re-hydrates", () => {
    const h = startedHarness();
    h.store.getState();
    h.disk.delete(STATE_KEY);
    h.events.length = 0;

    h.fireStorage(null);

    assert.deepEqual(Object.keys(h.store.getState().collections), []);
    assert.ok(h.events.includes("collections:changed"));
  });

  test("another tab's hidden-Collections change announces a repaint", () => {
    const h = startedHarness();
    h.disk.set(DISABLED_KEY, JSON.stringify(["some-collection"]));
    h.events.length = 0;

    h.fireStorage(DISABLED_KEY);

    assert.ok(h.events.includes("collections:changed"));
  });
});

// STRK-440: backup and image-vault export judge artwork against what storage holds, and
// fall back to memory only when the persisted state cannot be read reliably.
describe("exportState — persisted first, memory as the fail-safe fallback (STRK-440)", () => {
  test("prefers the persisted state over a stale in-memory copy", () => {
    const h = startedHarness();
    h.store.getState(); // hydrate this tab BEFORE the other tab writes (hydration is lazy)
    const other = makeHarness(persisted(h.disk));
    assert.equal(other.store.link(TEMPLATE, "2024", U.b).ok, true);
    h.disk.set(STATE_KEY, other.disk.get(STATE_KEY));

    assert.equal(h.store.exportState().collections[TEMPLATE].slots["2024"].primary, U.b);
  });

  test("falls back to the in-memory state when the persisted value is unreadable", () => {
    const h = startedHarness();
    h.store.getState(); // hydrate this tab BEFORE storage is damaged (hydration is lazy)
    h.disk.set(STATE_KEY, "{not json");

    const state = h.store.exportState();

    assert.equal(state, h.store.getState());
    assert.equal(state.collections[TEMPLATE].slots["2023"].primary, U.a);
  });
});

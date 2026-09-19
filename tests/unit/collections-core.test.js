// Unit tests for the Collections data layer (STRK-368, epic STRK-254).
//
// These tests ENCODE the data-model contract for js/collections-core.js — the pure,
// DOM-free core of the Collections module:
//
//   State shape      — { schema, collections: { id → collection } }, where a collection holds
//                      slots: { slotId → { primary, spares[], modified } }. Links live on the
//                      Collection, never on the Item (zero new item fields — STRK-235 lesson).
//                      Every runtime-string-keyed map is null-prototype (coding-standards:
//                      a custom slot may legitimately be named "constructor").
//   Link integrity   — an Item fills at most ONE slot per Collection; a slot is primary +
//                      up to MAX_SLOT_SPARES spares; unlinking a primary promotes the first
//                      spare; an emptied slot becomes a TOMBSTONE (primary:null) rather than
//                      a deleted key, so a later cross-device merge can tell "unlinked" from
//                      "never linked".
//   Disposed items   — never deleted from storage by disposal (undo must restore the link);
//                      resolveSlot() derives the EFFECTIVE slot through an isActive predicate.
//   Merge            — mergeStates(a, b) is commutative and idempotent, including on
//                      timestamp ties (STRK-154 convergence invariant).
//
// Harness: js/collections-core.js is a script-tag-global module (assigns window.collectionsCore).
// Mirroring spot-ratio-stats.test.js, the whole file is evaluated with a mock `window`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/collections-core.js", import.meta.url), "utf-8");

function loadCore() {
  const surface = {};
  new Function("window", src)(surface);
  return surface.collectionsCore;
}

const core = loadCore();

// assert/strict compares prototypes, and the state uses null-prototype maps by design.
// Round-trip through JSON to compare logical content only.
const plain = (value) => JSON.parse(JSON.stringify(value));

const T1 = "2026-09-18T10:00:00.000Z";
const T2 = "2026-09-18T11:00:00.000Z";
const T3 = "2026-09-18T12:00:00.000Z";

const U = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
  c: "33333333-3333-4333-8333-333333333333",
  d: "44444444-4444-4444-8444-444444444444",
  e: "55555555-5555-4555-8555-555555555555",
  f: "66666666-6666-4666-8666-666666666666",
};

/** Fresh state with one template-backed collection ("ase-type2"). */
function seeded(now = T1) {
  const state = core.createEmptyState();
  core.ensureCollection(state, {
    id: "ase-type2",
    kind: "template",
    templateSlug: "ase-type2",
    now,
  });
  return state;
}

describe("state shape", () => {
  test("createEmptyState returns schema 1 with an empty null-prototype collections map", () => {
    const state = core.createEmptyState();
    assert.equal(state.schema, 1);
    assert.equal(Object.getPrototypeOf(state.collections), null);
    assert.deepEqual(Object.keys(state.collections), []);
  });

  test("normalizeState turns garbage into an empty state", () => {
    for (const bad of [
      null,
      undefined,
      42,
      "x",
      [],
      { collections: [] },
      { collections: "nope" },
    ]) {
      const state = core.normalizeState(bad);
      assert.equal(state.schema, 1);
      assert.deepEqual(Object.keys(state.collections), []);
    }
  });

  test("normalizeState rehydrates persisted JSON into null-prototype maps at both levels", () => {
    const persisted = JSON.parse(
      JSON.stringify({
        schema: 1,
        collections: {
          "ase-type2": {
            id: "ase-type2",
            kind: "template",
            templateSlug: "ase-type2",
            createdAt: T1,
            metaModified: T1,
            lastModified: T1,
            slots: { 2024: { primary: U.a, spares: [U.b], modified: T1 } },
          },
        },
      })
    );
    const state = core.normalizeState(persisted);
    assert.equal(Object.getPrototypeOf(state.collections), null);
    assert.equal(Object.getPrototypeOf(state.collections["ase-type2"].slots), null);
    // Inherited Object.prototype members must not read as slots or collections.
    assert.equal(state.collections["constructor"], undefined);
    assert.equal(state.collections["ase-type2"].slots["constructor"], undefined);
    assert.equal(state.collections["ase-type2"].slots["2024"].primary, U.a);
  });

  test("normalizeState scrubs malformed slot links", () => {
    const state = core.normalizeState({
      schema: 1,
      collections: {
        x: {
          id: "x",
          kind: "template",
          templateSlug: "x",
          slots: {
            ok: {
              primary: U.a,
              spares: [U.b, U.b, 7, null, U.a, U.c, U.d, U.e, U.f],
              modified: T1,
            },
            bad: { primary: 99, spares: "nope" },
            junk: "not-an-object",
          },
        },
        mismatched: { id: "other", kind: "template", slots: {} },
        notObject: 5,
      },
    });
    const slots = state.collections.x.slots;
    // spares: non-strings dropped, duplicates dropped, primary never repeated as a spare, capped.
    assert.deepEqual(plain(slots.ok.spares), [U.b, U.c, U.d]);
    assert.equal(slots.bad.primary, null);
    assert.deepEqual(plain(slots.bad.spares), []);
    assert.equal(slots.junk, undefined);
    // A collection whose stored id disagrees with its key, or that is not an object, is dropped.
    assert.equal(state.collections.mismatched, undefined);
    assert.equal(state.collections.notObject, undefined);
  });
});

describe("Custom Collection artwork convergence", () => {
  test("cover and Slot stamps survive normalization and merge in either device order", () => {
    const left = seeded();
    const right = seeded();
    core.setArtwork(left, "ase-type2", null, true, { now: T1 });
    core.setArtwork(right, "ase-type2", "2024", true, { now: T2 });

    const merged = core.mergeStates(left, right);
    assert.deepEqual(plain(merged), plain(core.mergeStates(right, left)));
    assert.equal(merged.collections["ase-type2"].artwork.cover.present, true);
    assert.equal(merged.collections["ase-type2"].artwork["slot:2024"].present, true);
    assert.equal(Object.getPrototypeOf(merged.collections["ase-type2"].artwork), null);
  });

  test("a removal beats older art and ties, and a stale image cannot be restored", () => {
    const uploaded = seeded();
    core.setArtwork(uploaded, "ase-type2", null, true, { now: T1 });
    const removed = seeded();
    core.setArtwork(removed, "ase-type2", null, false, { now: T2 });
    const merged = core.mergeStates(uploaded, removed);
    assert.deepEqual(plain(merged), plain(core.mergeStates(removed, uploaded)));
    assert.equal(core.isCurrentArtwork(merged, "collection--ase-type2", Date.parse(T1)), false);

    const tied = seeded();
    core.setArtwork(tied, "ase-type2", null, false, { now: T1 });
    assert.equal(
      core.mergeStates(uploaded, tied).collections["ase-type2"].artwork.cover.present,
      false
    );
  });

  test("an older image is rejected when a newer upload wins", () => {
    const state = seeded();
    core.setArtwork(state, "ase-type2", "2024", true, { now: T3 });
    assert.equal(
      core.isCurrentArtwork(state, "collection--ase-type2--2024", Date.parse(T2)),
      false
    );
    assert.equal(core.isCurrentArtwork(state, "collection--ase-type2--2024", undefined), false);
    assert.equal(core.isCurrentArtwork(state, "collection--ase-type2--2024", Date.parse(T3)), true);
  });

  test("equal-time uploads pick the same content token in either merge order", () => {
    const left = seeded();
    const right = seeded();
    core.setArtwork(left, "ase-type2", null, true, { now: T2, digest: "aaaa" });
    core.setArtwork(right, "ase-type2", null, true, { now: T2, digest: "bbbb" });
    const merged = core.mergeStates(left, right);
    assert.deepEqual(plain(merged), plain(core.mergeStates(right, left)));
    assert.equal(merged.collections["ase-type2"].artwork.cover.digest, "bbbb");
    assert.equal(
      core.isCurrentArtwork(merged, "collection--ase-type2", Date.parse(T2), "aaaa"),
      false
    );
    assert.equal(
      core.isCurrentArtwork(merged, "collection--ase-type2", Date.parse(T2), "bbbb"),
      true
    );
  });
});

describe("ensureCollection", () => {
  test("creates a template collection keyed by its id and stamps timestamps", () => {
    const state = seeded(T1);
    const c = state.collections["ase-type2"];
    assert.equal(c.id, "ase-type2");
    assert.equal(c.kind, "template");
    assert.equal(c.templateSlug, "ase-type2");
    assert.equal(c.createdAt, T1);
    assert.equal(c.metaModified, T1);
    assert.equal(c.lastModified, T1);
    assert.equal(Object.getPrototypeOf(c.slots), null);
  });

  test("is idempotent — a second call returns the same collection untouched", () => {
    const state = seeded(T1);
    const again = core.ensureCollection(state, {
      id: "ase-type2",
      kind: "template",
      templateSlug: "ase-type2",
      now: T2,
    });
    assert.equal(again, state.collections["ase-type2"]);
    assert.equal(again.createdAt, T1);
    assert.equal(again.lastModified, T1);
  });

  test("revives a deleted collection instead of duplicating it", () => {
    const state = seeded(T1);
    core.removeCollection(state, "ase-type2", { now: T2 });
    const revived = core.ensureCollection(state, {
      id: "ase-type2",
      kind: "template",
      templateSlug: "ase-type2",
      now: T3,
    });
    assert.equal(revived.deletedAt, null);
    assert.equal(revived.metaModified, T3);
  });
});

describe("linkItem", () => {
  test("links a primary into an empty slot and stamps slot + collection", () => {
    const state = seeded(T1);
    const res = core.linkItem(state, "ase-type2", "2024", U.a, { now: T2 });
    assert.deepEqual(res, { ok: true, changed: true });
    const c = state.collections["ase-type2"];
    assert.deepEqual(plain(c.slots["2024"]), { primary: U.a, spares: [], modified: T2 });
    assert.equal(c.lastModified, T2);
    // Linking is slot activity, not a metadata edit.
    assert.equal(c.metaModified, T1);
  });

  test("re-linking the same item to the same slot is a no-op that does not bump timestamps", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2024", U.a, { now: T2 });
    const res = core.linkItem(state, "ase-type2", "2024", U.a, { now: T3 });
    assert.deepEqual(res, { ok: true, changed: false });
    assert.equal(state.collections["ase-type2"].slots["2024"].modified, T2);
    assert.equal(state.collections["ase-type2"].lastModified, T2);
  });

  test("an item fills at most one slot per collection", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T2 });
    const res = core.linkItem(state, "ase-type2", "2023", U.a, { now: T3 });
    assert.deepEqual(res, { ok: false, changed: false, reason: "already-linked", slotId: "2022" });
    assert.equal(state.collections["ase-type2"].slots["2023"], undefined);
  });

  test("an item already held as a SPARE elsewhere is also rejected", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T2 });
    core.linkItem(state, "ase-type2", "2022", U.b, { asSpare: true, now: T2 });
    const res = core.linkItem(state, "ase-type2", "2023", U.b, { now: T3 });
    assert.deepEqual(res, { ok: false, changed: false, reason: "already-linked", slotId: "2022" });
  });

  test("move:true relocates the item and promotes a spare in the slot it left", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T2 });
    core.linkItem(state, "ase-type2", "2022", U.b, { asSpare: true, now: T2 });
    const res = core.linkItem(state, "ase-type2", "2023", U.a, { move: true, now: T3 });
    assert.deepEqual(res, { ok: true, changed: true });
    const slots = state.collections["ase-type2"].slots;
    assert.deepEqual(plain(slots["2022"]), { primary: U.b, spares: [], modified: T3 });
    assert.deepEqual(plain(slots["2023"]), { primary: U.a, spares: [], modified: T3 });
  });

  test("an occupied slot refuses a different primary unless replace:true", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2024", U.a, { now: T2 });
    const refused = core.linkItem(state, "ase-type2", "2024", U.b, { now: T3 });
    assert.deepEqual(refused, { ok: false, changed: false, reason: "occupied" });
    const replaced = core.linkItem(state, "ase-type2", "2024", U.b, { replace: true, now: T3 });
    assert.deepEqual(replaced, { ok: true, changed: true });
    // Replace means "I linked the wrong item": the old primary is unlinked, not demoted.
    assert.deepEqual(plain(state.collections["ase-type2"].slots["2024"]), {
      primary: U.b,
      spares: [],
      modified: T3,
    });
  });

  test("asSpare appends up to MAX_SLOT_SPARES additional items, then refuses", () => {
    assert.equal(core.MAX_SLOT_SPARES, 3);
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T2 });
    for (const uuid of [U.b, U.c, U.d]) {
      assert.deepEqual(
        core.linkItem(state, "ase-type2", "2022", uuid, { asSpare: true, now: T2 }),
        { ok: true, changed: true }
      );
    }
    const full = core.linkItem(state, "ase-type2", "2022", U.e, { asSpare: true, now: T3 });
    assert.deepEqual(full, { ok: false, changed: false, reason: "spares-full" });
    assert.deepEqual(plain(state.collections["ase-type2"].slots["2022"].spares), [U.b, U.c, U.d]);
  });

  test("asSpare into an empty slot fills the primary instead", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2025", U.a, { asSpare: true, now: T2 });
    assert.deepEqual(plain(state.collections["ase-type2"].slots["2025"]), {
      primary: U.a,
      spares: [],
      modified: T2,
    });
  });

  test("linking revives a tombstoned slot", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2024", U.a, { now: T1 });
    core.unlinkItem(state, "ase-type2", "2024", U.a, { now: T2 });
    core.linkItem(state, "ase-type2", "2024", U.b, { now: T3 });
    assert.deepEqual(plain(state.collections["ase-type2"].slots["2024"]), {
      primary: U.b,
      spares: [],
      modified: T3,
    });
  });

  test("the same item may belong to two different collections", () => {
    const state = seeded(T1);
    core.ensureCollection(state, { id: "second", kind: "custom", now: T1 });
    assert.equal(core.linkItem(state, "ase-type2", "2024", U.a, { now: T2 }).ok, true);
    assert.equal(core.linkItem(state, "second", "anything", U.a, { now: T2 }).ok, true);
  });

  test("rejects unknown or deleted collections and invalid arguments", () => {
    const state = seeded(T1);
    assert.deepEqual(core.linkItem(state, "nope", "2024", U.a, { now: T2 }), {
      ok: false,
      changed: false,
      reason: "no-collection",
    });
    assert.deepEqual(core.linkItem(state, "ase-type2", "", U.a, { now: T2 }), {
      ok: false,
      changed: false,
      reason: "invalid",
    });
    assert.deepEqual(core.linkItem(state, "ase-type2", "2024", "", { now: T2 }), {
      ok: false,
      changed: false,
      reason: "invalid",
    });
    core.removeCollection(state, "ase-type2", { now: T2 });
    assert.deepEqual(core.linkItem(state, "ase-type2", "2024", U.a, { now: T3 }), {
      ok: false,
      changed: false,
      reason: "no-collection",
    });
  });

  test("a slot id that shadows an Object.prototype member behaves like any other", () => {
    const state = seeded(T1);
    assert.deepEqual(core.linkItem(state, "ase-type2", "constructor", U.a, { now: T2 }), {
      ok: true,
      changed: true,
    });
    assert.deepEqual(plain(state.collections["ase-type2"].slots["constructor"]), {
      primary: U.a,
      spares: [],
      modified: T2,
    });
  });
});

/** A 2022 slot holding U.a as primary with U.b and U.c queued as spares. */
const primaryWithTwoSpares = () => {
  const state = seeded(T1);
  core.linkItem(state, "ase-type2", "2022", U.a, { now: T1 });
  core.linkItem(state, "ase-type2", "2022", U.b, { asSpare: true, now: T1 });
  core.linkItem(state, "ase-type2", "2022", U.c, { asSpare: true, now: T1 });
  return state;
};

describe("unlinkItem / promoteSpare", () => {
  test("unlinking the primary promotes the first spare", () => {
    const state = primaryWithTwoSpares();
    const res = core.unlinkItem(state, "ase-type2", "2022", U.a, { now: T2 });
    assert.deepEqual(res, { ok: true, changed: true, promoted: U.b });
    assert.deepEqual(plain(state.collections["ase-type2"].slots["2022"]), {
      primary: U.b,
      spares: [U.c],
      modified: T2,
    });
  });

  test("unlinking the only item leaves a tombstone, not a missing key", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2024", U.a, { now: T1 });
    const res = core.unlinkItem(state, "ase-type2", "2024", U.a, { now: T2 });
    assert.deepEqual(res, { ok: true, changed: true, promoted: null });
    assert.deepEqual(plain(state.collections["ase-type2"].slots["2024"]), {
      primary: null,
      spares: [],
      modified: T2,
    });
    assert.equal(state.collections["ase-type2"].lastModified, T2);
  });

  test("unlinking a spare leaves the primary alone", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T1 });
    core.linkItem(state, "ase-type2", "2022", U.b, { asSpare: true, now: T1 });
    const res = core.unlinkItem(state, "ase-type2", "2022", U.b, { now: T2 });
    assert.deepEqual(res, { ok: true, changed: true, promoted: null });
    assert.deepEqual(plain(state.collections["ase-type2"].slots["2022"]), {
      primary: U.a,
      spares: [],
      modified: T2,
    });
  });

  test("unlinking an item that is not in the slot reports not-linked and changes nothing", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T1 });
    const res = core.unlinkItem(state, "ase-type2", "2022", U.b, { now: T2 });
    assert.deepEqual(res, { ok: false, changed: false, reason: "not-linked" });
    assert.equal(state.collections["ase-type2"].slots["2022"].modified, T1);
  });

  test("promoteSpare swaps a spare into the primary seat", () => {
    const state = primaryWithTwoSpares();
    const res = core.promoteSpare(state, "ase-type2", "2022", U.c, { now: T2 });
    assert.deepEqual(res, { ok: true, changed: true });
    assert.deepEqual(plain(state.collections["ase-type2"].slots["2022"]), {
      primary: U.c,
      spares: [U.a, U.b],
      modified: T2,
    });
    assert.deepEqual(core.promoteSpare(state, "ase-type2", "2022", U.f, { now: T3 }), {
      ok: false,
      changed: false,
      reason: "not-linked",
    });
  });
});

describe("pruneItem / sweepDanglingLinks", () => {
  test("pruneItem removes an item from every collection and promotes spares", () => {
    const state = seeded(T1);
    core.ensureCollection(state, { id: "second", kind: "custom", now: T1 });
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T1 });
    core.linkItem(state, "ase-type2", "2022", U.b, { asSpare: true, now: T1 });
    core.linkItem(state, "second", "s1", U.c, { now: T1 });
    core.linkItem(state, "second", "s1", U.a, { asSpare: true, now: T1 });
    core.linkItem(state, "second", "s2", U.d, { now: T1 });

    const res = core.pruneItem(state, U.a, { now: T2 });
    assert.equal(res.changed, true);
    assert.deepEqual(
      plain(res.removed).sort((x, y) => x.collectionId.localeCompare(y.collectionId)),
      [
        { collectionId: "ase-type2", slotId: "2022" },
        { collectionId: "second", slotId: "s1" },
      ]
    );
    assert.deepEqual(plain(state.collections["ase-type2"].slots["2022"]), {
      primary: U.b,
      spares: [],
      modified: T2,
    });
    assert.deepEqual(plain(state.collections.second.slots.s1), {
      primary: U.c,
      spares: [],
      modified: T2,
    });
    // Untouched slots keep their stamp.
    assert.equal(state.collections.second.slots.s2.modified, T1);
  });

  test("pruneItem on an unlinked item reports no change and bumps nothing", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T1 });
    const res = core.pruneItem(state, U.f, { now: T2 });
    assert.deepEqual(plain(res), { changed: false, removed: [] });
    assert.equal(state.collections["ase-type2"].lastModified, T1);
  });

  test("sweepDanglingLinks drops links to items that no longer exist", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T1 });
    core.linkItem(state, "ase-type2", "2022", U.b, { asSpare: true, now: T1 });
    core.linkItem(state, "ase-type2", "2023", U.c, { now: T1 });
    const res = core.sweepDanglingLinks(state, new Set([U.b]), { now: T2 });
    assert.deepEqual(res, { changed: true, removed: 2 });
    const slots = state.collections["ase-type2"].slots;
    assert.deepEqual(plain(slots["2022"]), { primary: U.b, spares: [], modified: T2 });
    assert.deepEqual(plain(slots["2023"]), { primary: null, spares: [], modified: T2 });
  });

  test("sweepDanglingLinks with every item known changes nothing", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T1 });
    assert.deepEqual(core.sweepDanglingLinks(state, new Set([U.a]), { now: T2 }), {
      changed: false,
      removed: 0,
    });
    assert.equal(state.collections["ase-type2"].slots["2022"].modified, T1);
  });
});

describe("resolveSlot / collectionProgress / findMemberships", () => {
  const active = (set) => (uuid) => set.has(uuid);

  test("resolveSlot hides inactive items without touching storage", () => {
    const link = { primary: U.a, spares: [U.b, U.c], modified: T1 };
    // Primary disposed → the first ACTIVE spare is the effective primary.
    assert.deepEqual(core.resolveSlot(link, active(new Set([U.b, U.c]))), {
      primary: U.b,
      spares: [U.c],
    });
    assert.deepEqual(core.resolveSlot(link, active(new Set([U.a, U.c]))), {
      primary: U.a,
      spares: [U.c],
    });
    assert.deepEqual(core.resolveSlot(link, active(new Set())), { primary: null, spares: [] });
    assert.deepEqual(core.resolveSlot(undefined, active(new Set([U.a]))), {
      primary: null,
      spares: [],
    });
    assert.deepEqual(
      core.resolveSlot({ primary: null, spares: [], modified: T1 }, active(new Set())),
      { primary: null, spares: [] }
    );
    // The stored link is never mutated by resolution.
    assert.deepEqual(link, { primary: U.a, spares: [U.b, U.c], modified: T1 });
  });

  test("collectionProgress counts effective primaries against the slot definitions", () => {
    const state = seeded(T1);
    core.linkItem(state, "ase-type2", "2022", U.a, { now: T1 });
    core.linkItem(state, "ase-type2", "2023", U.b, { now: T1 }); // b is disposed below
    core.linkItem(state, "ase-type2", "ghost-slot", U.c, { now: T1 }); // not in the definitions
    const defs = [{ id: "2021-t2" }, { id: "2022" }, { id: "2023" }, { id: "2024" }];
    const progress = core.collectionProgress(
      state.collections["ase-type2"],
      defs,
      active(new Set([U.a, U.c]))
    );
    assert.deepEqual(progress, { owned: 1, total: 4, missing: 3, pct: 25 });
    assert.deepEqual(
      core.collectionProgress(state.collections["ase-type2"], [], active(new Set())),
      {
        owned: 0,
        total: 0,
        missing: 0,
        pct: 0,
      }
    );
  });

  test("findMemberships reports every live slot an item occupies, with its role", () => {
    const state = seeded(T1);
    core.ensureCollection(state, { id: "second", kind: "custom", now: T1 });
    core.ensureCollection(state, { id: "gone", kind: "custom", now: T1 });
    core.linkItem(state, "ase-type2", "2024", U.a, { now: T1 });
    core.linkItem(state, "second", "s1", U.b, { now: T1 });
    core.linkItem(state, "second", "s1", U.a, { asSpare: true, now: T1 });
    core.linkItem(state, "gone", "s9", U.a, { now: T1 });
    core.removeCollection(state, "gone", { now: T2 });

    const found = core
      .findMemberships(state, U.a)
      .sort((x, y) => x.collectionId.localeCompare(y.collectionId));
    assert.deepEqual(plain(found), [
      { collectionId: "ase-type2", slotId: "2024", role: "primary" },
      { collectionId: "second", slotId: "s1", role: "spare" },
    ]);
    assert.deepEqual(plain(core.findMemberships(state, U.f)), []);
  });
});

describe("custom collections", () => {
  test("slugifySlotId yields stable, de-duplicated, storage-safe ids", () => {
    assert.equal(core.slugifySlotId("1881-CC", []), "1881-cc");
    assert.equal(core.slugifySlotId("  Proof (W) ", []), "proof-w");
    assert.equal(core.slugifySlotId("2021 Type 2", ["2021-type-2"]), "2021-type-2-2");
    assert.equal(
      core.slugifySlotId("2021 Type 2", ["2021-type-2", "2021-type-2-2"]),
      "2021-type-2-3"
    );
    assert.equal(core.slugifySlotId("!!!", []), "slot");
    assert.equal(core.slugifySlotId("", ["slot"]), "slot-2");
    assert.equal(core.slugifySlotId("__proto__", []), "proto");
  });

  test("createCustomCollection builds a definition with stable slot ids", () => {
    const state = core.createEmptyState();
    const res = core.createCustomCollection(state, {
      id: "custom-1",
      name: "  Morgan Dollars — Carson City ",
      metal: "Silver",
      description: "GSA hoard set",
      clonedFrom: null,
      slots: [
        { label: "1881-CC", year: "1881", note: "" },
        { label: "1882-CC", year: "1882", note: "GSA" },
        { label: "1882-CC", year: "1882", note: "second example" },
      ],
      now: T1,
    });
    assert.equal(res.ok, true);
    const c = state.collections["custom-1"];
    assert.equal(c.kind, "custom");
    assert.equal(c.templateSlug, null);
    assert.equal(c.name, "Morgan Dollars — Carson City");
    assert.deepEqual(plain(c.definition), {
      metal: "Silver",
      description: "GSA hoard set",
      slots: [
        { id: "1881-cc", label: "1881-CC", year: "1881", note: "" },
        { id: "1882-cc", label: "1882-CC", year: "1882", note: "GSA" },
        { id: "1882-cc-2", label: "1882-CC", year: "1882", note: "second example" },
      ],
    });
    assert.equal(c.clonedFrom, null);
  });

  test("createCustomCollection refuses a blank name, an existing id, or zero slots", () => {
    const state = core.createEmptyState();
    const base = { id: "custom-1", name: "Set", metal: "Silver", slots: [{ label: "A" }], now: T1 };
    assert.deepEqual(core.createCustomCollection(state, { ...base, name: "   " }), {
      ok: false,
      reason: "invalid-name",
    });
    assert.deepEqual(core.createCustomCollection(state, { ...base, slots: [] }), {
      ok: false,
      reason: "no-slots",
    });
    assert.equal(core.createCustomCollection(state, base).ok, true);
    assert.deepEqual(core.createCustomCollection(state, base), { ok: false, reason: "exists" });
  });

  test("updateCustomDefinition keeps ids across renames and tombstones links in removed slots", () => {
    const state = core.createEmptyState();
    core.createCustomCollection(state, {
      id: "custom-1",
      name: "Set",
      metal: "Silver",
      slots: [{ label: "Alpha" }, { label: "Beta" }],
      now: T1,
    });
    core.linkItem(state, "custom-1", "alpha", U.a, { now: T1 });
    core.linkItem(state, "custom-1", "beta", U.b, { now: T1 });

    const res = core.updateCustomDefinition(state, "custom-1", {
      name: "Renamed set",
      slots: [
        { id: "alpha", label: "Alpha (renamed)", year: "1999", note: "n" },
        { label: "Gamma" },
      ],
      now: T2,
    });
    assert.equal(res.ok, true);
    const c = state.collections["custom-1"];
    assert.equal(c.name, "Renamed set");
    assert.equal(c.metaModified, T2);
    assert.deepEqual(plain(c.definition.slots), [
      { id: "alpha", label: "Alpha (renamed)", year: "1999", note: "n" },
      { id: "gamma", label: "Gamma", year: "", note: "" },
    ]);
    // The renamed slot keeps its link; the removed slot's link is tombstoned.
    assert.equal(c.slots.alpha.primary, U.a);
    assert.deepEqual(plain(c.slots.beta), { primary: null, spares: [], modified: T2 });
  });

  test("updateCustomDefinition refuses template collections", () => {
    const state = seeded(T1);
    assert.deepEqual(
      core.updateCustomDefinition(state, "ase-type2", {
        name: "x",
        slots: [{ label: "a" }],
        now: T2,
      }),
      {
        ok: false,
        reason: "not-custom",
      }
    );
  });

  test("removeCollection tombstones; listCollections hides tombstones", () => {
    const state = seeded(T1);
    core.ensureCollection(state, { id: "second", kind: "custom", now: T1 });
    assert.deepEqual(core.removeCollection(state, "second", { now: T2 }), {
      ok: true,
      changed: true,
    });
    assert.equal(state.collections.second.deletedAt, T2);
    assert.equal(state.collections.second.metaModified, T2);
    assert.deepEqual(
      core.listCollections(state).map((c) => c.id),
      ["ase-type2"]
    );
    assert.deepEqual(core.removeCollection(state, "missing", { now: T2 }), {
      ok: false,
      changed: false,
      reason: "no-collection",
    });
  });

  test("slotDefsFor prefers the custom definition, else the template's slots", () => {
    const template = { slug: "ase-type2", slots: [{ id: "2021-t2" }, { id: "2022" }] };
    const state = seeded(T1);
    assert.deepEqual(plain(core.slotDefsFor(state.collections["ase-type2"], template)), [
      { id: "2021-t2" },
      { id: "2022" },
    ]);
    core.createCustomCollection(state, {
      id: "custom-1",
      name: "Set",
      metal: "Gold",
      slots: [{ label: "Only" }],
      now: T1,
    });
    assert.deepEqual(plain(core.slotDefsFor(state.collections["custom-1"], template)), [
      { id: "only", label: "Only", year: "", note: "" },
    ]);
    assert.deepEqual(plain(core.slotDefsFor(state.collections["ase-type2"], null)), []);
  });
});

describe("suggestItemsForSlot", () => {
  const profile = {
    metal: "Silver",
    weight: 1,
    weightUnit: "oz",
    match: {
      names: ["American Silver Eagle"],
      abbreviations: ["ase"],
      keywords: ["silver eagle", "eagle"],
    },
  };
  // Stand-in for window.autocomplete.normalizeItemName: strips a leading year + trailing grade noise.
  const normalizeName = (name) =>
    String(name || "")
      .replace(/^(1[89]\d{2}|20\d{2})\s+/, "")
      .replace(/\s+(BU|MS-?\d{2}|PCGS.*|NGC.*)$/i, "")
      .trim();
  const item = (uuid, name, year, extra = {}) => ({
    uuid,
    name,
    year,
    metal: "Silver",
    weight: 1,
    weightUnit: "oz",
    ...extra,
  });

  test("ranks exact-name matches over abbreviations over bare keywords", () => {
    const items = [
      item(U.c, "Eagle", "2023"),
      item(U.b, "ASE 2023", "2023"),
      item(U.a, "2023 American Silver Eagle BU", "2023"),
    ];
    const out = core.suggestItemsForSlot(profile, { id: "2023", year: 2023 }, items, {
      normalizeName,
    });
    assert.deepEqual(
      out.map((s) => s.item.uuid),
      [U.a, U.b, U.c]
    );
    assert.ok(out[0].score > out[1].score && out[1].score > out[2].score);
    assert.ok(out[0].reasons.includes("name") && out[0].reasons.includes("year"));
    assert.ok(out[1].reasons.includes("abbreviation"));
    assert.ok(out[2].reasons.includes("keyword"));
  });

  test("filters out the wrong year, metal, weight, and already-linked items", () => {
    const items = [
      item(U.a, "2022 American Silver Eagle", "2022"),
      item(U.b, "2023 American Gold Eagle", "2023", { metal: "Gold" }),
      item(U.c, "2023 American Silver Eagle 1/2 oz", "2023", { weight: 0.5 }),
      item(U.d, "2023 American Silver Eagle", "2023"),
      item(U.e, "2023 Silver Britannia", "2023"),
      item(U.f, "2023 American Silver Eagle", "2023"),
    ];
    const out = core.suggestItemsForSlot(profile, { id: "2023", year: 2023 }, items, {
      normalizeName,
      excludeUuids: new Set([U.f]),
    });
    assert.deepEqual(
      out.map((s) => s.item.uuid),
      [U.d]
    );
  });

  test("reads the year from the item name when item.year is blank, and accepts grams", () => {
    const items = [
      item(U.a, "2024 American Silver Eagle", ""),
      item(U.b, "2024 American Silver Eagle", "2024", { weight: 31.1035, weightUnit: "g" }),
      item(U.c, "American Silver Eagle", ""),
    ];
    const out = core.suggestItemsForSlot(profile, { id: "2024", year: 2024 }, items, {
      normalizeName,
    });
    assert.deepEqual(out.map((s) => s.item.uuid).sort(), [U.a, U.b].sort());
  });

  test("slot hints separate the two 2021 reverse types", () => {
    const slot = {
      id: "2021-t2",
      year: 2021,
      hints: {
        prefer: ["type 2", "type ii", "t2", "t-2"],
        reject: ["type 1", "type i", "t1", "t-1"],
      },
    };
    const items = [
      item(U.a, "2021 American Silver Eagle Type 1", "2021"),
      item(U.b, "2021 American Silver Eagle", "2021"),
      item(U.c, "2021 American Silver Eagle Type 2 MS-70", "2021"),
      item(U.d, "2021 American Silver Eagle (T-2)", "2021"),
      item(U.e, "2021 American Silver Eagle Type II", "2021"),
    ];
    const out = core.suggestItemsForSlot(profile, slot, items, { normalizeName });
    const ids = out.map((s) => s.item.uuid);
    // Explicit Type 1 is rejected outright; the unlabelled coin stays, ranked below explicit Type 2s.
    assert.equal(ids.includes(U.a), false);
    assert.equal(ids[ids.length - 1], U.b);
    assert.deepEqual(ids.slice(0, 3).sort(), [U.c, U.d, U.e].sort());
    assert.ok(out[0].reasons.includes("variant"));
  });

  test("a yearless slot (custom checklist) matches on name alone and tolerates missing options", () => {
    const custom = {
      metal: "Silver",
      match: { names: ["Morgan Dollar"], abbreviations: [], keywords: ["morgan"] },
    };
    const items = [
      {
        uuid: U.a,
        name: "1884-CC Morgan Dollar MS-63",
        year: "1884",
        metal: "Silver",
        weight: 0.7734,
        weightUnit: "oz",
      },
      {
        uuid: U.b,
        name: "2023 Silver Britannia",
        year: "2023",
        metal: "Silver",
        weight: 1,
        weightUnit: "oz",
      },
    ];
    const out = core.suggestItemsForSlot(custom, { id: "any" }, items);
    assert.deepEqual(
      out.map((s) => s.item.uuid),
      [U.a]
    );
  });
});

describe("mergeStates — commutative and idempotent (STRK-154 invariant)", () => {
  function build(steps) {
    const state = core.createEmptyState();
    steps(state);
    return state;
  }
  const bothWays = (a, b) => [plain(core.mergeStates(a, b)), plain(core.mergeStates(b, a))];
  const template = (steps) => {
    const state = seeded(T1);
    if (steps) steps(state);
    return state;
  };

  test("disjoint collections union", () => {
    const a = template((s) => {
      core.linkItem(s, "ase-type2", "2024", U.a, { now: T1 });
    });
    const b = build((s) => {
      core.createCustomCollection(s, {
        id: "custom-1",
        name: "Set",
        metal: "Gold",
        slots: [{ label: "One" }],
        now: T1,
      });
    });
    const [ab, ba] = bothWays(a, b);
    assert.deepEqual(ab, ba);
    assert.deepEqual(Object.keys(ab.collections).sort(), ["ase-type2", "custom-1"]);
  });

  test("different slots filled on two devices both survive", () => {
    const a = template((s) => {
      core.linkItem(s, "ase-type2", "2023", U.a, { now: T2 });
    });
    const b = template((s) => {
      core.linkItem(s, "ase-type2", "2024", U.b, { now: T3 });
    });
    const [ab, ba] = bothWays(a, b);
    assert.deepEqual(ab, ba);
    assert.equal(ab.collections["ase-type2"].slots["2023"].primary, U.a);
    assert.equal(ab.collections["ase-type2"].slots["2024"].primary, U.b);
    assert.equal(ab.collections["ase-type2"].lastModified, T3);
  });

  test("the newer slot write wins, and an unlink tombstone beats an older link", () => {
    const a = template((s) => {
      core.linkItem(s, "ase-type2", "2024", U.a, { now: T1 });
      core.linkItem(s, "ase-type2", "2025", U.c, { now: T3 });
    });
    const b = template((s) => {
      core.linkItem(s, "ase-type2", "2024", U.a, { now: T1 });
      core.unlinkItem(s, "ase-type2", "2024", U.a, { now: T2 });
      core.linkItem(s, "ase-type2", "2025", U.d, { now: T2 });
    });
    const [ab, ba] = bothWays(a, b);
    assert.deepEqual(ab, ba);
    assert.deepEqual(ab.collections["ase-type2"].slots["2024"], {
      primary: null,
      spares: [],
      modified: T2,
    });
    assert.equal(ab.collections["ase-type2"].slots["2025"].primary, U.c);
  });

  test("a timestamp TIE with divergent content still converges identically in both orders", () => {
    const a = template((s) => {
      core.linkItem(s, "ase-type2", "2024", U.a, { now: T2 });
    });
    const b = template((s) => {
      core.linkItem(s, "ase-type2", "2024", U.b, { now: T2 });
    });
    const [ab, ba] = bothWays(a, b);
    assert.deepEqual(ab, ba);
    assert.ok([U.a, U.b].includes(ab.collections["ase-type2"].slots["2024"].primary));
    assert.equal(ab.collections["ase-type2"].slots["2024"].modified, T2);
  });

  test("a rename is not lost to later slot activity on the other device", () => {
    const a = build((s) => {
      core.createCustomCollection(s, {
        id: "custom-1",
        name: "Set",
        metal: "Gold",
        slots: [{ label: "One" }],
        now: T1,
      });
      core.updateCustomDefinition(s, "custom-1", {
        name: "Renamed",
        slots: [{ id: "one", label: "One" }],
        now: T2,
      });
    });
    const b = build((s) => {
      core.createCustomCollection(s, {
        id: "custom-1",
        name: "Set",
        metal: "Gold",
        slots: [{ label: "One" }],
        now: T1,
      });
      core.linkItem(s, "custom-1", "one", U.a, { now: T3 });
    });
    const [ab, ba] = bothWays(a, b);
    assert.deepEqual(ab, ba);
    assert.equal(ab.collections["custom-1"].name, "Renamed");
    assert.equal(ab.collections["custom-1"].slots.one.primary, U.a);
    assert.equal(ab.collections["custom-1"].metaModified, T2);
    assert.equal(ab.collections["custom-1"].lastModified, T3);
  });

  test("a delete newer than the other side's metadata wins; a newer revive beats the delete", () => {
    const base = (s) =>
      core.createCustomCollection(s, {
        id: "custom-1",
        name: "Set",
        metal: "Gold",
        slots: [{ label: "One" }],
        now: T1,
      });
    const deleted = build((s) => {
      base(s);
      core.removeCollection(s, "custom-1", { now: T2 });
    });
    const untouched = build(base);
    const [ab, ba] = bothWays(deleted, untouched);
    assert.deepEqual(ab, ba);
    assert.equal(ab.collections["custom-1"].deletedAt, T2);

    const revived = build((s) => {
      base(s);
      core.updateCustomDefinition(s, "custom-1", {
        name: "Kept",
        slots: [{ id: "one", label: "One" }],
        now: T3,
      });
    });
    const [cd, dc] = bothWays(deleted, revived);
    assert.deepEqual(cd, dc);
    assert.equal(cd.collections["custom-1"].deletedAt, null);
    assert.equal(cd.collections["custom-1"].name, "Kept");
  });

  test("merge is idempotent and never mutates its inputs", () => {
    const a = template((s) => {
      core.linkItem(s, "ase-type2", "2022", U.a, { now: T2 });
      core.linkItem(s, "ase-type2", "2022", U.b, { asSpare: true, now: T2 });
    });
    const b = template((s) => {
      core.linkItem(s, "ase-type2", "2023", U.c, { now: T3 });
    });
    const snapshotA = plain(a);
    const snapshotB = plain(b);
    const merged = core.mergeStates(a, b);
    assert.deepEqual(plain(a), snapshotA);
    assert.deepEqual(plain(b), snapshotB);
    assert.deepEqual(plain(core.mergeStates(a, a)), snapshotA);
    assert.deepEqual(plain(core.mergeStates(merged, b)), plain(merged));
    assert.deepEqual(plain(core.mergeStates(merged, a)), plain(merged));
    assert.equal(Object.getPrototypeOf(merged.collections), null);
    assert.equal(Object.getPrototypeOf(merged.collections["ase-type2"].slots), null);
  });

  test("merging with an empty or malformed side returns the other side's content", () => {
    const a = template((s) => {
      core.linkItem(s, "ase-type2", "2022", U.a, { now: T2 });
    });
    assert.deepEqual(plain(core.mergeStates(a, core.createEmptyState())), plain(a));
    assert.deepEqual(plain(core.mergeStates(null, a)), plain(a));
    assert.deepEqual(plain(core.mergeStates("junk", undefined)), plain(core.createEmptyState()));
  });
});

// STRK-412: the boot sweep must never delete keys it does not recognise (an older build on top
// of newer data wiped Collections). Only explicitly retired keys are removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../../js/utils-storage.js", import.meta.url), "utf-8");
const start = src.indexOf("const RETIRED_STORAGE_KEYS");
const end = src.indexOf("/**\n * One-time migration (STRK-140)");
const load = (store) => {
  const localStorage = {
    get length() {
      return Object.keys(store).length;
    },
    key: (i) => Object.keys(store)[i] ?? null,
    removeItem: (k) => delete store[k],
  };
  const context = vm.createContext({ localStorage });
  vm.runInContext(
    `${src.slice(start, end)}\nthis.cleanupStorage = cleanupStorage;\nthis.RETIRED_STORAGE_KEYS = RETIRED_STORAGE_KEYS;`,
    context
  );
  return context;
};

test("cleanupStorage keeps allowlisted and unknown future keys, removes retired ones", () => {
  const store = {
    metalInventory: "[]",
    collectionState: '{"slots":{}}',
    collectionsHubPreferences: "{}",
    someFutureKey: "x",
  };
  const { cleanupStorage, RETIRED_STORAGE_KEYS } = load(store);
  store[RETIRED_STORAGE_KEYS[0]] = "stale";
  cleanupStorage();
  assert.deepEqual(Object.keys(store).sort(), [
    "collectionState",
    "collectionsHubPreferences",
    "metalInventory",
    "someFutureKey",
  ]);
});

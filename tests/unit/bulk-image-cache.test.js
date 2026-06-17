// Characterization tests for BulkImageCache.cacheAll() — STRK-170 cohort 3.2.
//
// These pin the OBSERVABLE behavior of cacheAll() so the complexity refactor
// (extract-helper) stays behavior-preserving. We do not assert internal helper
// structure — only the externally visible result summary, callback sequencing,
// skip/already-cached accounting, URL repair, local-cache fallback, and abort.
//
// Loaded via slice-and-eval (the project's unit pattern): the whole IIFE in
// js/bulk-image-cache.js is evaluated inside a new Function that supplies the
// browser globals it closes over (window, inventory, imageCache, catalogAPI,
// applyNumistaTags, saveItemTags, saveInventory, setTimeout). The IIFE assigns
// window.BulkImageCache, which we then read back out.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/bulk-image-cache.js", import.meta.url), "utf-8");

/**
 * Build a fresh BulkImageCache instance wired to the supplied test doubles.
 * Each call evaluates the module source in an isolated scope so the module-private
 * _running / _aborted flags start clean (the real module is a singleton).
 * @param {Object} env - Test doubles for the closed-over globals.
 * @returns {Object} The BulkImageCache singleton assigned to the fake window.
 */
function loadModule(env) {
  // The module reads some globals bare (inventory, imageCache, applyNumistaTags,
  // saveItemTags, saveInventory) and others via window.* (window.imageCache,
  // window.catalogAPI, window.catalogManager). Mirror the doubles onto both the
  // bare scope and the fake window so every access path resolves.
  const inventory = env.inventory ?? [];
  const win = {
    imageCache: env.imageCache,
    catalogAPI: env.catalogAPI,
    catalogManager: env.catalogManager,
  };
  const scope = {
    window: win,
    inventory,
    imageCache: env.imageCache,
    catalogManager: env.catalogManager,
    catalogAPI: env.catalogAPI,
    applyNumistaTags: env.applyNumistaTags,
    saveItemTags: env.saveItemTags,
    saveInventory: env.saveInventory,
    // Make the inter-request delay a no-op so tests run instantly.
    setTimeout: (fn) => {
      fn();
      return 0;
    },
  };
  const keys = Object.keys(scope);
  const fn = new Function(...keys, src + "\nreturn window.BulkImageCache;");
  return fn(...keys.map((k) => scope[k]));
}

/** A minimal in-memory imageCache double honoring the methods cacheAll() calls. */
function makeImageCache(seedMeta = {}) {
  const store = new Map(Object.entries(seedMeta));
  return {
    _store: store,
    isAvailable: () => true,
    init: async () => {},
    getMetadata: async (id) => store.get(id) ?? null,
    cacheMetadata: async (id, data) => {
      store.set(id, data);
    },
  };
}

describe("BulkImageCache.cacheAll() — observable behavior (STRK-170 cohort 3.2)", () => {
  let logs;
  let progress;
  let saveItemTagsCalls;
  let saveInventoryCalls;
  let appliedTags;

  beforeEach(() => {
    logs = [];
    progress = [];
    saveItemTagsCalls = 0;
    saveInventoryCalls = 0;
    appliedTags = [];
  });

  /** Standard test doubles shared across cases; callers override pieces as needed. */
  function baseEnv(overrides = {}) {
    return {
      applyNumistaTags: (...args) => {
        appliedTags.push(args);
        return { skippedEdits: [] };
      },
      saveItemTags: () => {
        saveItemTagsCalls++;
      },
      saveInventory: () => {
        saveInventoryCalls++;
      },
      ...overrides,
    };
  }

  /** onComplete-capturing options object. */
  function opts(extra = {}) {
    return {
      delay: 0,
      onProgress: (p) => progress.push(p),
      onLog: (l) => logs.push(l),
      ...extra,
    };
  }

  test("no-op (no result) when window.imageCache is absent", async () => {
    const mod = loadModule(baseEnv({ imageCache: undefined, inventory: [] }));
    let completed = false;
    await mod.cacheAll(opts({ onComplete: () => (completed = true) }));
    assert.equal(completed, false, "onComplete must not fire with no imageCache");
  });

  test("empty inventory reports an all-zero summary", async () => {
    const mod = loadModule(baseEnv({ imageCache: makeImageCache(), inventory: [] }));
    let summary = null;
    await mod.cacheAll(opts({ onComplete: (s) => (summary = s) }));
    assert.ok(summary, "onComplete fired");
    assert.equal(summary.synced, 0);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.failed, 0);
    assert.equal(summary.apiLookups, 0);
    assert.equal(typeof summary.elapsed, "number");
    assert.equal(progress.length, 0, "no progress for zero entries");
  });

  test("already-cached item (meta present + valid url) is skipped, not synced", async () => {
    const item = {
      uuid: "u1",
      numistaId: "100",
      obverseImageUrl: "https://cdn.example.com/a.jpg",
    };
    const imageCache = makeImageCache({ 100: { tags: [] } });
    const mod = loadModule(
      baseEnv({ imageCache, inventory: [item], catalogAPI: { lookupItem: async () => null } })
    );
    let summary = null;
    await mod.cacheAll(opts({ onComplete: (s) => (summary = s) }));
    assert.equal(summary.skipped, 1);
    assert.equal(summary.synced, 0);
    assert.equal(summary.apiLookups, 0, "no API call for already-cached item");
    assert.deepEqual(progress, [{ current: 1, total: 1, catalogId: "100" }]);
    assert.ok(
      logs.some((l) => l.status === "skip-cached" && l.message === "Already synced"),
      "emits skip-cached log"
    );
    assert.equal(saveItemTagsCalls, 1, "saveItemTags persisted once after a skip");
    assert.equal(saveInventoryCalls, 0, "saveInventory NOT called when nothing synced");
  });

  test("uncached item is synced via API, increments apiLookups, persists inventory", async () => {
    const item = { uuid: "u2", numistaId: "200" };
    const imageCache = makeImageCache();
    let lookups = 0;
    const catalogAPI = {
      lookupItem: async (id) => {
        lookups++;
        return { id, tags: ["silver"], imageUrl: "https://cdn/x.jpg" };
      },
    };
    const mod = loadModule(baseEnv({ imageCache, inventory: [item], catalogAPI }));
    let summary = null;
    await mod.cacheAll(opts({ onComplete: (s) => (summary = s) }));
    assert.equal(summary.synced, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.failed, 0);
    assert.equal(summary.apiLookups, 1);
    assert.equal(lookups, 1);
    assert.equal(item.numistaId, "200", "numistaId preserved");
    assert.ok(imageCache._store.has("200"), "metadata cached to IDB");
    assert.equal(saveInventoryCalls, 1, "saveInventory called once after a sync");
    assert.equal(saveItemTagsCalls, 1, "saveItemTags called once after a sync");
    assert.ok(logs.some((l) => l.status === "metadata" && l.message === "Synced"));
  });

  test("API failure on an uncached item increments failed (double-counts), not synced", async () => {
    // Characterizes CURRENT behavior: a thrown lookup increments `failed` twice —
    // once in the catch block, once in the trailing `else if (!hasMetaCached)`
    // branch (apiResult stays null). The refactor must preserve this exactly.
    const item = { uuid: "u3", numistaId: "300" };
    const imageCache = makeImageCache();
    const catalogAPI = {
      lookupItem: async () => {
        throw new Error("boom");
      },
    };
    const mod = loadModule(baseEnv({ imageCache, inventory: [item], catalogAPI }));
    let summary = null;
    await mod.cacheAll(opts({ onComplete: (s) => (summary = s) }));
    assert.equal(summary.failed, 2);
    assert.equal(summary.synced, 0);
    assert.ok(logs.some((l) => l.status === "meta-failed"));
  });

  test("malformed image URL on the item is cleared and a url-repair log is emitted", async () => {
    const item = { uuid: "u4", numistaId: "400", obverseImageUrl: "garbage-not-a-url" };
    const imageCache = makeImageCache();
    const catalogAPI = { lookupItem: async (id) => ({ id, tags: [] }) };
    const mod = loadModule(baseEnv({ imageCache, inventory: [item], catalogAPI }));
    await mod.cacheAll(opts());
    assert.equal(item.obverseImageUrl, "", "malformed obverse URL cleared");
    assert.ok(
      logs.some((l) => l.status === "url-repair"),
      "url-repair log emitted"
    );
  });

  test("local provider cache supplies URLs without an API call", async () => {
    const item = { uuid: "u5", numistaId: "500" };
    const imageCache = makeImageCache();
    let lookups = 0;
    const catalogAPI = {
      lookupItem: async () => {
        lookups++;
        return null;
      },
      localProvider: {
        localData: { 500: { imageUrl: "https://cdn/local.jpg", tags: [] } },
      },
    };
    const mod = loadModule(baseEnv({ imageCache, inventory: [item], catalogAPI }));
    let summary = null;
    await mod.cacheAll(opts({ onComplete: (s) => (summary = s) }));
    assert.equal(summary.synced, 1, "synced from local cache");
    assert.equal(lookups, 0, "no API lookup when local cache hits");
    assert.equal(summary.apiLookups, 0);
    assert.ok(logs.some((l) => l.status === "local-cache"));
  });

  test("isRunning reflects in-flight state and resets on completion", async () => {
    const mod = loadModule(baseEnv({ imageCache: makeImageCache(), inventory: [] }));
    assert.equal(mod.isRunning(), false);
    await mod.cacheAll(opts());
    assert.equal(mod.isRunning(), false, "running flag reset after completion");
  });

  test("abort stops the loop early (second item not processed)", async () => {
    const items = [
      { uuid: "a1", numistaId: "601" },
      { uuid: "a2", numistaId: "602" },
    ];
    const imageCache = makeImageCache();
    const seenIds = [];
    const catalogAPI = {
      lookupItem: async (id) => {
        seenIds.push(id);
        return { id, tags: [] };
      },
    };
    const mod = loadModule(baseEnv({ imageCache, inventory: items, catalogAPI }));
    let summary = null;
    await mod.cacheAll(
      opts({
        onComplete: (s) => (summary = s),
        onProgress: (p) => {
          progress.push(p);
          if (p.current === 1) mod.abort();
        },
      })
    );
    assert.equal(seenIds.length, 1, "only the first item was looked up before abort");
    assert.equal(summary.synced, 1);
  });

  test("multiple eligible items report a combined summary and ordered progress", async () => {
    const items = [
      { uuid: "m1", numistaId: "701" },
      { uuid: "m2", numistaId: "702" },
      // already-cached (meta + valid url) → skip
      { uuid: "m3", numistaId: "703", obverseImageUrl: "https://cdn/c.jpg" },
    ];
    const imageCache = makeImageCache({ 703: { tags: [] } });
    const catalogAPI = { lookupItem: async (id) => ({ id, tags: [] }) };
    const mod = loadModule(baseEnv({ imageCache, inventory: items, catalogAPI }));
    let summary = null;
    await mod.cacheAll(opts({ onComplete: (s) => (summary = s) }));
    assert.equal(summary.synced, 2);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.failed, 0);
    assert.equal(progress.length, 3);
    assert.deepEqual(
      progress.map((p) => p.catalogId),
      ["701", "702", "703"]
    );
  });
});

// Unit tests for STRK-313 — catalog_api_config usage counters must not read
// as a settings change in cloud sync.
//
// Root cause: catalog_api_config stores credentials AND per-device volatile
// usage counters (numistaUsage.used/month, pcgsUsage.used/date) in one synced
// blob. Every Numista/PCGS request ticks a counter and rewrites the blob, so:
//   - computeSettingsHash changed → sync engine saw "settings changed" and
//     kept pulling (same failure family as the STRK-156 hash loop), and
//   - DiffEngine.compareSettings (raw string equality for string inputs)
//     flagged "Catalog API Keys: ••• configured → ••• configured" in the
//     Review Sync Changes modal on every cross-device session switch.
//
// Fix under test (three layers):
//   1. cloud-sync.js _canonicalizeSettingValue(key-aware) strips
//      numistaUsage/pcgsUsage before hashing.
//   2. diff-engine.js compareSettings normalizes catalog_api_config before
//      the equality check (original values still flow to changed entries).
//   3. cloud-sync.js _mergeCatalogUsageCounters keeps max(used) within the
//      same period when a genuine credential change is applied.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- DiffEngine: whole-file eval with a mock window (pure data module) ---
const diffSrc = readFileSync(new URL("../../js/diff-engine.js", import.meta.url), "utf-8");
const win = {};
new Function("window", diffSrc)(win);
const DiffEngine = win.DiffEngine;
assert.ok(
  DiffEngine && typeof DiffEngine.compareSettings === "function",
  "DiffEngine.compareSettings must load"
);

// --- cloud-sync.js settings-hash block (slice-and-eval, mirrors
//     cloud-sync-settings-hash.test.js) ---
const syncSrc = readFileSync(new URL("../../js/cloud-sync.js", import.meta.url), "utf-8");
const start = syncSrc.indexOf("function _stableCanonicalString");
const end = syncSrc.indexOf("function initSyncTabCoordination");
assert.ok(start !== -1 && end !== -1 && end > start, "could not locate settings-hash block");
const block = syncSrc.slice(start, end);

function sha256BufferToHex(buffer) {
  const a = new Uint8Array(buffer);
  let hex = "";
  for (let j = 0; j < a.length; j++) hex += ("0" + a[j].toString(16)).slice(-2);
  return hex;
}

const SCOPE = ["metalInventory", "appTheme", "catalog_api_config"];

function buildBlock(store) {
  const localStorageMock = { getItem: (k) => (k in store ? store[k] : null) };
  const factory = new Function(
    "crypto",
    "localStorage",
    "SYNC_SCOPE_KEYS",
    "__decompressIfNeeded",
    "TextEncoder",
    "sha256BufferToHex",
    "debugLog",
    block + "\nreturn { computeSettingsHash, _mergeCatalogUsageCounters, _mergeUsagePeriod };"
  );
  return factory(
    globalThis.crypto,
    localStorageMock,
    SCOPE,
    (v) => v, // catalog blob is far below the compression threshold
    TextEncoder,
    sha256BufferToHex,
    () => {}
  );
}

// --- Fixtures --------------------------------------------------------------

/** Build a catalog_api_config raw localStorage string. */
function catalogBlob({
  apiKey = "FAKE-fixture-numista",
  quota = 2000,
  nUsed = 0,
  nMonth = "2026-07",
  token = "",
  pUsed = 0,
  pDate = "2026-07-30",
} = {}) {
  return JSON.stringify({
    numista: { apiKey, quota },
    numistaUsage: { used: nUsed, month: nMonth },
    pcgs: { bearerToken: token },
    pcgsUsage: { used: pUsed, date: pDate },
    local: { enabled: true },
  });
}

// --- Layer 2: DiffEngine.compareSettings -----------------------------------

describe("STRK-313 compareSettings ignores volatile catalog usage counters", () => {
  test("raw strings, identical credentials, different Numista counters → unchanged", () => {
    const local = { catalog_api_config: catalogBlob({ nUsed: 41 }) };
    const remote = { catalog_api_config: catalogBlob({ nUsed: 42 }) };
    const res = DiffEngine.compareSettings(local, remote);
    assert.equal(res.changed.length, 0, "counter tick must not flag a settings diff");
    assert.equal(res.unchanged.length, 1);
  });

  test("different PCGS counter AND rolled-over date → unchanged", () => {
    const local = { catalog_api_config: catalogBlob({ pUsed: 9, pDate: "2026-07-29" }) };
    const remote = { catalog_api_config: catalogBlob({ pUsed: 2, pDate: "2026-07-30" }) };
    const res = DiffEngine.compareSettings(local, remote);
    assert.equal(res.changed.length, 0, "usage period rollover must not flag a diff");
  });

  test("genuine apiKey change still flags, carrying ORIGINAL raw values", () => {
    const localRaw = catalogBlob({ apiKey: "FAKE-old-key", nUsed: 41 });
    const remoteRaw = catalogBlob({ apiKey: "FAKE-new-key", nUsed: 42 });
    const res = DiffEngine.compareSettings(
      { catalog_api_config: localRaw },
      { catalog_api_config: remoteRaw }
    );
    assert.equal(res.changed.length, 1, "credential change must still be detected");
    assert.equal(res.changed[0].localVal, localRaw, "changed entry must carry original local");
    assert.equal(res.changed[0].remoteVal, remoteRaw, "changed entry must carry original remote");
  });

  test("quota change still flags a diff", () => {
    const res = DiffEngine.compareSettings(
      { catalog_api_config: catalogBlob({ quota: 2000 }) },
      { catalog_api_config: catalogBlob({ quota: 4000 }) }
    );
    assert.equal(res.changed.length, 1);
  });

  test("parsed-object inputs (vault restore path) with counter-only diff → unchanged", () => {
    const res = DiffEngine.compareSettings(
      { catalog_api_config: JSON.parse(catalogBlob({ nUsed: 5 })) },
      { catalog_api_config: JSON.parse(catalogBlob({ nUsed: 900 })) }
    );
    assert.equal(res.changed.length, 0);
  });

  test("raw string vs parsed object of same credentials → unchanged (mixed-path bonus)", () => {
    const res = DiffEngine.compareSettings(
      { catalog_api_config: catalogBlob({ nUsed: 5 }) },
      { catalog_api_config: JSON.parse(catalogBlob({ nUsed: 6 })) }
    );
    assert.equal(res.changed.length, 0);
  });

  test("unparseable string degrades to raw comparison (no throw)", () => {
    const res = DiffEngine.compareSettings(
      { catalog_api_config: "CMP2:not-json" },
      { catalog_api_config: "CMP2:other" }
    );
    assert.equal(res.changed.length, 1, "differing unparseable strings stay a diff");
  });

  test("non-catalog keys are untouched by the normalization", () => {
    const res = DiffEngine.compareSettings({ appTheme: "dark" }, { appTheme: "light" });
    assert.equal(res.changed.length, 1);
  });
});

// --- Layer 1: computeSettingsHash ------------------------------------------

describe("STRK-313 computeSettingsHash ignores volatile catalog usage counters", () => {
  test("identical credentials, different counters → EQUAL hash", async () => {
    const h1 = await buildBlock({
      appTheme: "dark",
      catalog_api_config: catalogBlob({ nUsed: 41, pUsed: 3 }),
    }).computeSettingsHash();
    const h2 = await buildBlock({
      appTheme: "dark",
      catalog_api_config: catalogBlob({ nUsed: 42, pUsed: 9, pDate: "2026-07-29" }),
    }).computeSettingsHash();
    assert.equal(h1, h2, "counter ticks must not churn the settings hash");
  });

  test("genuine apiKey change → DIFFERENT hash", async () => {
    const h1 = await buildBlock({
      catalog_api_config: catalogBlob({ apiKey: "FAKE-old-key" }),
    }).computeSettingsHash();
    const h2 = await buildBlock({
      catalog_api_config: catalogBlob({ apiKey: "FAKE-new-key" }),
    }).computeSettingsHash();
    assert.notEqual(h1, h2, "credential changes must still change the hash");
  });
});

// --- Layer 3: _mergeCatalogUsageCounters ------------------------------------

describe("STRK-313 _mergeCatalogUsageCounters on genuine credential apply", () => {
  const { _mergeCatalogUsageCounters } = buildBlock({});

  test("same period → remote credentials with max(used)", () => {
    const localRaw = catalogBlob({ apiKey: "FAKE-old-key", nUsed: 41, pUsed: 7 });
    const remoteRaw = catalogBlob({ apiKey: "FAKE-new-key", nUsed: 5, pUsed: 2 });
    const merged = JSON.parse(_mergeCatalogUsageCounters(localRaw, remoteRaw));
    assert.equal(merged.numista.apiKey, "FAKE-new-key", "credentials come from remote");
    assert.equal(merged.numistaUsage.used, 41, "same-month counter keeps the max");
    assert.equal(merged.pcgsUsage.used, 7, "same-date counter keeps the max");
  });

  test("later local period wins outright", () => {
    const localRaw = catalogBlob({ nUsed: 3, nMonth: "2026-08" });
    const remoteRaw = catalogBlob({ nUsed: 1999, nMonth: "2026-07" });
    const merged = JSON.parse(_mergeCatalogUsageCounters(localRaw, remoteRaw));
    assert.equal(merged.numistaUsage.month, "2026-08");
    assert.equal(merged.numistaUsage.used, 3);
  });

  test("later remote period wins outright", () => {
    const localRaw = catalogBlob({ pUsed: 900, pDate: "2026-07-29" });
    const remoteRaw = catalogBlob({ pUsed: 1, pDate: "2026-07-30" });
    const merged = JSON.parse(_mergeCatalogUsageCounters(localRaw, remoteRaw));
    assert.equal(merged.pcgsUsage.date, "2026-07-30");
    assert.equal(merged.pcgsUsage.used, 1);
  });

  test("null local → remote passes through verbatim", () => {
    const remoteRaw = catalogBlob();
    assert.equal(_mergeCatalogUsageCounters(null, remoteRaw), remoteRaw);
  });

  test("unparseable local → remote passes through verbatim", () => {
    const remoteRaw = catalogBlob();
    assert.equal(_mergeCatalogUsageCounters("not-json", remoteRaw), remoteRaw);
  });
});

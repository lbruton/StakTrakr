// Unit tests for STRK-315 — metalApiConfig usage counters must not read as a
// settings change in cloud sync, and matched settings rows must carry their
// values through to the renderer.
//
// Follow-up to STRK-313, which fixed the same bug class in catalog_api_config
// but left metalApiConfig — the store actually churning on the reporter's
// devices — untouched.
//
// Root cause (defect 1): metalApiConfig stores per-device request counters
// (usage[provider].used) and a period stamp (usageMonth) in the same synced
// blob as the credentials. STAKTRAKR is keyless (requiresKey:false) and
// autoRefresh defaults on, so usage.STAKTRAKR.used++ fires on every app boot
// even with zero API keys saved. Two devices diverge immediately →
// computeSettingsHash mismatches → the Review Sync Changes modal opens every
// session with "API Keys: ••• configured → ••• configured".
//
// Unlike numistaUsage/pcgsUsage — whole objects STRK-313 could drop — usage[p]
// is {quota, used} where quota IS user-editable (the quota modal, events.js).
// The strip must be nested: drop `used`, keep `quota`.
//
// Root cause (defect 2): compareSettings emitted two record shapes —
// {key, localVal, remoteVal} for changed and {key, val} for unchanged — while
// diff-modal.js reads mEntry.localVal for BOTH. Every matched row rendered
// undefined, which _formatSettingValue printed as "not set" / "—". That is
// what made STRK-313 target the wrong store: a configured Numista key showed
// as "Catalog API Keys — not set".
//
// Fix under test:
//   1. cloud-sync.js _stripVolatileSettingFields — metalApiConfig branch
//      (hashing path).
//   2. diff-engine.js _normalizeSettingForCompare — metalApiConfig branch
//      (diffing path). Both must move together or the hash and the diff
//      disagree and the modal opens with zero rows.
//   3. cloud-sync.js _mergeSpotUsageCounters — max(used) within the same
//      usageMonth, gated per-provider on key equality (mirrors the STRK-313
//      credential gate so a fresh key doesn't inherit an exhausted counter).
//   4. diff-engine.js compareSettings — unchanged entries carry
//      localVal/remoteVal like changed entries do.

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
//     strk-313-catalog-usage-sync.test.js) ---
const syncSrc = readFileSync(new URL("../../js/cloud-sync.js", import.meta.url), "utf-8");
const start = syncSrc.indexOf("function _stableCanonicalString");
const end = syncSrc.indexOf("function initSyncTabCoordination");
assert.ok(start !== -1 && end !== -1 && end > start, "could not locate settings-hash block");
const block = syncSrc.slice(start, end);

/**
 * Hex-encode a SHA-256 digest ArrayBuffer (mirrors the cloud-sync helper).
 * @param {ArrayBuffer} buffer digest bytes
 * @returns {string} lowercase hex string
 */
function sha256BufferToHex(buffer) {
  const a = new Uint8Array(buffer);
  let hex = "";
  for (let j = 0; j < a.length; j++) hex += ("0" + a[j].toString(16)).slice(-2);
  return hex;
}

const SCOPE = ["metalInventory", "appTheme", "metalApiConfig"];

/**
 * Evaluate the sliced cloud-sync settings-hash block against a mock
 * localStorage backed by `store`.
 * @param {Object<string,string>} store key → raw localStorage string
 * @returns {{computeSettingsHash: Function, _mergeSpotUsageCounters: Function}}
 */
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
    block + "\nreturn { computeSettingsHash, _mergeSpotUsageCounters };"
  );
  return factory(
    globalThis.crypto,
    localStorageMock,
    SCOPE,
    (v) => v, // fixture blobs are far below the compression threshold
    TextEncoder,
    sha256BufferToHex,
    () => {}
  );
}

// --- Fixtures --------------------------------------------------------------

/**
 * Build a metalApiConfig raw localStorage string in the shape saveApiConfig
 * persists. `keys` values are base64 in production; the fixture uses opaque
 * strings since only equality matters here.
 */
function spotBlob({
  provider = "STAKTRAKR",
  keys = {},
  stUsed = 0,
  stQuota = 5000,
  mdUsed = 0,
  mdQuota = 100,
  usageMonth = "2026-07",
  cacheHours = 24,
  metals = { STAKTRAKR: { silver: true, gold: true, platinum: true, palladium: true } },
} = {}) {
  return JSON.stringify({
    provider,
    keys,
    cacheHours,
    cacheTimeouts: { STAKTRAKR: 0, METALS_DEV: 24 },
    customConfig: { baseUrl: "", endpoint: "", format: "symbol" },
    metals,
    usage: {
      STAKTRAKR: { quota: stQuota, used: stUsed },
      METALS_DEV: { quota: mdQuota, used: mdUsed },
    },
    historyDays: { STAKTRAKR: 30, METALS_DEV: 29 },
    historyTimes: { STAKTRAKR: [], METALS_DEV: [] },
    syncMode: {},
    autoRefresh: { STAKTRAKR: true },
    usageMonth,
  });
}

// --- Defect 1, layer 2: DiffEngine.compareSettings -------------------------

describe("STRK-315 compareSettings ignores volatile spot usage counters", () => {
  test("keyless STAKTRAKR counter tick with NO keys saved → unchanged", () => {
    // The reporter's exact configuration: zero API keys, StakTrakr feed, the
    // counter ticking once per app boot on each device.
    const res = DiffEngine.compareSettings(
      { metalApiConfig: spotBlob({ stUsed: 47 }) },
      { metalApiConfig: spotBlob({ stUsed: 52 }) }
    );
    assert.equal(res.changed.length, 0, "keyless counter tick must not flag a settings diff");
    assert.equal(res.unchanged.length, 1);
  });

  test("usageMonth rollover with reset counters → unchanged", () => {
    const res = DiffEngine.compareSettings(
      { metalApiConfig: spotBlob({ stUsed: 900, usageMonth: "2026-07" }) },
      { metalApiConfig: spotBlob({ stUsed: 3, usageMonth: "2026-08" }) }
    );
    assert.equal(res.changed.length, 0, "month rollover must not flag a diff");
  });

  test("quota change STILL flags a diff (quota is user-editable)", () => {
    const res = DiffEngine.compareSettings(
      { metalApiConfig: spotBlob({ mdQuota: 100 }) },
      { metalApiConfig: spotBlob({ mdQuota: 250 }) }
    );
    assert.equal(res.changed.length, 1, "quota is a real user setting — must still sync");
  });

  test("genuine key change still flags, carrying ORIGINAL raw values", () => {
    const localRaw = spotBlob({ keys: { METALS_DEV: "FAKE-old" } });
    const remoteRaw = spotBlob({ keys: { METALS_DEV: "FAKE-new" } });
    const res = DiffEngine.compareSettings(
      { metalApiConfig: localRaw },
      { metalApiConfig: remoteRaw }
    );
    assert.equal(res.changed.length, 1, "credential change must still be detected");
    assert.equal(res.changed[0].localVal, localRaw, "changed entry carries original local");
    assert.equal(res.changed[0].remoteVal, remoteRaw, "changed entry carries original remote");
  });

  test("provider switch still flags a diff", () => {
    const res = DiffEngine.compareSettings(
      { metalApiConfig: spotBlob({ provider: "STAKTRAKR" }) },
      { metalApiConfig: spotBlob({ provider: "METALS_DEV" }) }
    );
    assert.equal(res.changed.length, 1);
  });

  test("metals toggle still flags a diff", () => {
    const res = DiffEngine.compareSettings(
      {
        metalApiConfig: spotBlob({
          metals: { STAKTRAKR: { silver: true, gold: true, platinum: true, palladium: true } },
        }),
      },
      {
        metalApiConfig: spotBlob({
          metals: { STAKTRAKR: { silver: false, gold: true, platinum: true, palladium: true } },
        }),
      }
    );
    assert.equal(res.changed.length, 1);
  });

  test("cacheHours change still flags a diff", () => {
    const res = DiffEngine.compareSettings(
      { metalApiConfig: spotBlob({ cacheHours: 24 }) },
      { metalApiConfig: spotBlob({ cacheHours: 6 }) }
    );
    assert.equal(res.changed.length, 1);
  });

  test("parsed-object inputs (vault restore path) with counter-only diff → unchanged", () => {
    const res = DiffEngine.compareSettings(
      { metalApiConfig: JSON.parse(spotBlob({ stUsed: 5 })) },
      { metalApiConfig: JSON.parse(spotBlob({ stUsed: 900 })) }
    );
    assert.equal(res.changed.length, 0);
  });

  test("unparseable string degrades to raw comparison (no throw)", () => {
    const res = DiffEngine.compareSettings(
      { metalApiConfig: "CMP2:not-json" },
      { metalApiConfig: "CMP2:other" }
    );
    assert.equal(res.changed.length, 1, "differing unparseable strings stay a diff");
  });

  test("missing usage map entirely → no throw, still comparable", () => {
    const bare = JSON.stringify({ provider: "STAKTRAKR", keys: {} });
    const res = DiffEngine.compareSettings({ metalApiConfig: bare }, { metalApiConfig: bare });
    assert.equal(res.changed.length, 0);
  });

  test("STRK-313 catalog behavior is preserved (no regression)", () => {
    const catalog = (used) =>
      JSON.stringify({
        numista: { apiKey: "FAKE-k", quota: 2000 },
        numistaUsage: { used, month: "2026-07" },
      });
    const res = DiffEngine.compareSettings(
      { catalog_api_config: catalog(41) },
      { catalog_api_config: catalog(58) }
    );
    assert.equal(res.changed.length, 0);
  });
});

// --- Defect 2: unchanged entries carry localVal/remoteVal ------------------

describe("STRK-315 compareSettings unchanged entries carry renderable values", () => {
  test("unchanged entry exposes localVal (diff-modal.js reads mEntry.localVal)", () => {
    const raw = JSON.stringify({ numista: { apiKey: "FAKE-configured" } });
    const res = DiffEngine.compareSettings(
      { catalog_api_config: raw },
      { catalog_api_config: raw }
    );
    assert.equal(res.unchanged.length, 1);
    assert.equal(
      res.unchanged[0].localVal,
      raw,
      "a configured key must not render as 'not set' in the matched list"
    );
  });

  test("unchanged entry exposes remoteVal too", () => {
    const res = DiffEngine.compareSettings({ appTheme: "dark" }, { appTheme: "dark" });
    assert.equal(res.unchanged[0].localVal, "dark");
    assert.equal(res.unchanged[0].remoteVal, "dark");
  });

  test("legacy `val` property is retained for back-compat", () => {
    const res = DiffEngine.compareSettings({ appTheme: "dark" }, { appTheme: "dark" });
    assert.equal(res.unchanged[0].val, "dark");
  });

  test("volatile-only difference: unchanged entry still carries the LOCAL value", () => {
    // Counters differ but the setting is matched — the row must show the local
    // device's blob, not undefined.
    const localRaw = spotBlob({ stUsed: 47 });
    const res = DiffEngine.compareSettings(
      { metalApiConfig: localRaw },
      { metalApiConfig: spotBlob({ stUsed: 52 }) }
    );
    assert.equal(res.unchanged[0].localVal, localRaw);
  });
});

// --- Defect 1, layer 1: computeSettingsHash --------------------------------

describe("STRK-315 computeSettingsHash ignores volatile spot usage counters", () => {
  test("identical config, different counters → EQUAL hash", async () => {
    const h1 = await buildBlock({
      appTheme: "dark",
      metalApiConfig: spotBlob({ stUsed: 47 }),
    }).computeSettingsHash();
    const h2 = await buildBlock({
      appTheme: "dark",
      metalApiConfig: spotBlob({ stUsed: 52 }),
    }).computeSettingsHash();
    assert.equal(h1, h2, "counter ticks must not churn the settings hash");
  });

  test("usageMonth rollover → EQUAL hash", async () => {
    const h1 = await buildBlock({
      metalApiConfig: spotBlob({ stUsed: 900, usageMonth: "2026-07" }),
    }).computeSettingsHash();
    const h2 = await buildBlock({
      metalApiConfig: spotBlob({ stUsed: 0, usageMonth: "2026-08" }),
    }).computeSettingsHash();
    assert.equal(h1, h2);
  });

  test("genuine key change → DIFFERENT hash", async () => {
    const h1 = await buildBlock({
      metalApiConfig: spotBlob({ keys: { METALS_DEV: "FAKE-old" } }),
    }).computeSettingsHash();
    const h2 = await buildBlock({
      metalApiConfig: spotBlob({ keys: { METALS_DEV: "FAKE-new" } }),
    }).computeSettingsHash();
    assert.notEqual(h1, h2, "credential changes must still change the hash");
  });

  test("quota change → DIFFERENT hash", async () => {
    const h1 = await buildBlock({
      metalApiConfig: spotBlob({ mdQuota: 100 }),
    }).computeSettingsHash();
    const h2 = await buildBlock({
      metalApiConfig: spotBlob({ mdQuota: 250 }),
    }).computeSettingsHash();
    assert.notEqual(h1, h2, "quota is a real setting — must still change the hash");
  });

  test("hash path and diff path agree on the same pair (no zero-row modal)", async () => {
    // If the hash says "changed" but the diff finds nothing, the modal opens
    // empty. Both layers must classify this pair identically.
    const localRaw = spotBlob({ stUsed: 47 });
    const remoteRaw = spotBlob({ stUsed: 52 });
    const h1 = await buildBlock({ metalApiConfig: localRaw }).computeSettingsHash();
    const h2 = await buildBlock({ metalApiConfig: remoteRaw }).computeSettingsHash();
    const res = DiffEngine.compareSettings(
      { metalApiConfig: localRaw },
      { metalApiConfig: remoteRaw }
    );
    assert.equal(h1 === h2, res.changed.length === 0, "hash and diff must agree");
  });
});

// --- Defect 1, layer 3: _mergeSpotUsageCounters ----------------------------

describe("STRK-315 _mergeSpotUsageCounters on genuine config apply", () => {
  const { _mergeSpotUsageCounters } = buildBlock({});

  test("same month, keyless provider → max(used) wins", () => {
    const localRaw = spotBlob({ stUsed: 47 });
    const remoteRaw = spotBlob({ stUsed: 12 });
    const merged = JSON.parse(_mergeSpotUsageCounters(localRaw, remoteRaw));
    assert.equal(
      merged.usage.STAKTRAKR.used,
      47,
      "keyless provider has no credential to change — always merges to max"
    );
  });

  test("same month, same key → max(used) wins", () => {
    const localRaw = spotBlob({ keys: { METALS_DEV: "FAKE-shared" }, mdUsed: 80 });
    const remoteRaw = spotBlob({ keys: { METALS_DEV: "FAKE-shared" }, mdUsed: 5 });
    const merged = JSON.parse(_mergeSpotUsageCounters(localRaw, remoteRaw));
    assert.equal(merged.usage.METALS_DEV.used, 80);
  });

  test("changed key → remote counter kept verbatim (fresh key doesn't inherit usage)", () => {
    const localRaw = spotBlob({ keys: { METALS_DEV: "FAKE-old" }, mdUsed: 100 });
    const remoteRaw = spotBlob({ keys: { METALS_DEV: "FAKE-new" }, mdUsed: 0 });
    const merged = JSON.parse(_mergeSpotUsageCounters(localRaw, remoteRaw));
    assert.equal(merged.keys.METALS_DEV, "FAKE-new", "credentials come from remote");
    assert.equal(
      merged.usage.METALS_DEV.used,
      0,
      "a fresh key must not inherit the old key's exhausted counter"
    );
  });

  test("per-provider gating: changed METALS_DEV key does not block STAKTRAKR merge", () => {
    const localRaw = spotBlob({ keys: { METALS_DEV: "FAKE-old" }, mdUsed: 100, stUsed: 47 });
    const remoteRaw = spotBlob({ keys: { METALS_DEV: "FAKE-new" }, mdUsed: 0, stUsed: 12 });
    const merged = JSON.parse(_mergeSpotUsageCounters(localRaw, remoteRaw));
    assert.equal(merged.usage.METALS_DEV.used, 0, "changed key → remote");
    assert.equal(merged.usage.STAKTRAKR.used, 47, "unchanged keyless provider → max");
  });

  test("quota-only change still merges counters to max", () => {
    const localRaw = spotBlob({ keys: { METALS_DEV: "FAKE-shared" }, mdQuota: 100, mdUsed: 80 });
    const remoteRaw = spotBlob({ keys: { METALS_DEV: "FAKE-shared" }, mdQuota: 250, mdUsed: 5 });
    const merged = JSON.parse(_mergeSpotUsageCounters(localRaw, remoteRaw));
    assert.equal(merged.usage.METALS_DEV.quota, 250, "quota comes from remote");
    assert.equal(merged.usage.METALS_DEV.used, 80, "counter is tied to the key, not the quota");
  });

  test("later remote month wins outright", () => {
    const localRaw = spotBlob({ stUsed: 900, usageMonth: "2026-07" });
    const remoteRaw = spotBlob({ stUsed: 4, usageMonth: "2026-08" });
    const merged = JSON.parse(_mergeSpotUsageCounters(localRaw, remoteRaw));
    assert.equal(merged.usageMonth, "2026-08");
    assert.equal(
      merged.usage.STAKTRAKR.used,
      4,
      "a newer month must not inherit last month's count"
    );
  });

  test("later local month wins outright", () => {
    const localRaw = spotBlob({ stUsed: 4, usageMonth: "2026-08" });
    const remoteRaw = spotBlob({ stUsed: 900, usageMonth: "2026-07" });
    const merged = JSON.parse(_mergeSpotUsageCounters(localRaw, remoteRaw));
    assert.equal(merged.usageMonth, "2026-08");
    assert.equal(merged.usage.STAKTRAKR.used, 4);
  });

  test("non-usage fields always come from remote", () => {
    const localRaw = spotBlob({ provider: "STAKTRAKR", cacheHours: 24 });
    const remoteRaw = spotBlob({ provider: "METALS_DEV", cacheHours: 6 });
    const merged = JSON.parse(_mergeSpotUsageCounters(localRaw, remoteRaw));
    assert.equal(merged.provider, "METALS_DEV");
    assert.equal(merged.cacheHours, 6);
  });

  test("null local → remote passes through verbatim", () => {
    const remoteRaw = spotBlob();
    assert.equal(_mergeSpotUsageCounters(null, remoteRaw), remoteRaw);
  });

  test("unparseable local → remote passes through verbatim", () => {
    const remoteRaw = spotBlob();
    assert.equal(_mergeSpotUsageCounters("not-json", remoteRaw), remoteRaw);
  });

  test("missing usage map on either side → no throw", () => {
    const bare = JSON.stringify({ provider: "STAKTRAKR", keys: {} });
    assert.doesNotThrow(() => _mergeSpotUsageCounters(bare, spotBlob()));
    assert.doesNotThrow(() => _mergeSpotUsageCounters(spotBlob(), bare));
  });
});

// --- Defect 3: honest labelling of the spot config blob --------------------

const settingsSrc = readFileSync(
  new URL("../../js/diff-modal-settings.js", import.meta.url),
  "utf-8"
);

/**
 * Load js/diff-modal-settings.js against a mock window, optionally supplying
 * API_PROVIDERS so both the friendly-name and bare-id paths are reachable.
 * @param {Object|undefined} providers API_PROVIDERS stand-in, or undefined
 * @returns {Object} the module's window.DiffModalSettings export
 */
function loadSettingsRenderers(providers) {
  const w = {};
  new Function("window", "API_PROVIDERS", settingsSrc)(w, providers);
  return w.DiffModalSettings;
}

describe("STRK-315 formatSettingValue reports the spot blob honestly", () => {
  const withNames = loadSettingsRenderers({
    STAKTRAKR: { name: "StakTrakr" },
    METALS_DEV: { name: "Metals.dev" },
  });
  const noNames = loadSettingsRenderers(undefined);

  test("no keys saved renders 'no keys', never 'configured'", () => {
    const out = withNames.formatSettingValue("metalApiConfig", spotBlob({ keys: {} }));
    assert.match(out, /no keys/, "a keyless config must not claim to be configured");
    assert.doesNotMatch(out, /configured/);
  });

  test("selected provider is named", () => {
    const out = withNames.formatSettingValue(
      "metalApiConfig",
      spotBlob({ provider: "METALS_DEV" })
    );
    assert.match(out, /Metals\.dev/);
  });

  test("one key renders singular, two render plural — count only, never material", () => {
    const one = withNames.formatSettingValue(
      "metalApiConfig",
      spotBlob({ keys: { METALS_DEV: "FAKE-secret-aaa" } })
    );
    assert.match(one, /1 key(?!s)/);
    assert.doesNotMatch(one, /FAKE-secret/, "key material must never be rendered");

    const two = withNames.formatSettingValue(
      "metalApiConfig",
      spotBlob({ keys: { METALS_DEV: "FAKE-a", METAL_PRICE_API: "FAKE-b" } })
    );
    assert.match(two, /2 keys/);
  });

  test("empty-string key values are not counted as configured", () => {
    const out = withNames.formatSettingValue(
      "metalApiConfig",
      spotBlob({ keys: { METALS_DEV: "" } })
    );
    assert.match(out, /no keys/);
  });

  test("a provider switch is now visible in the rendered value", () => {
    // The whole point of defect 3: these two must not render identically.
    const a = withNames.formatSettingValue("metalApiConfig", spotBlob({ provider: "STAKTRAKR" }));
    const b = withNames.formatSettingValue("metalApiConfig", spotBlob({ provider: "METALS_DEV" }));
    assert.notEqual(a, b, "a provider change must be distinguishable in the diff row");
  });

  test("falls back to the raw provider id when API_PROVIDERS is unavailable", () => {
    const out = noNames.formatSettingValue("metalApiConfig", spotBlob({ provider: "METALS_DEV" }));
    assert.match(out, /METALS_DEV/);
  });

  test("null / unparseable input → 'not set'", () => {
    assert.equal(withNames.formatSettingValue("metalApiConfig", null), "not set");
    assert.equal(withNames.formatSettingValue("metalApiConfig", "not-json"), "not set");
  });

  test("parsed-object input works as well as a raw string", () => {
    const out = withNames.formatSettingValue(
      "metalApiConfig",
      JSON.parse(spotBlob({ keys: { METALS_DEV: "FAKE-a" } }))
    );
    assert.match(out, /1 key/);
  });

  test("catalog_api_config masking is unchanged", () => {
    assert.equal(
      withNames.formatSettingValue("catalog_api_config", '{"numista":{"apiKey":"FAKE"}}'),
      "••• configured"
    );
    assert.equal(withNames.formatSettingValue("catalog_api_config", null), "not set");
  });
});

// Unit tests for settings apply/restore integrity + boot-repair (STRK-157, parent STRK-154).
//
// Object-valued SYNC_SCOPE_KEYS were observed stored as the literal string
// "[object Object],[object Object]" — an array/object written without JSON.stringify.
// The sync apply path (_applyAndFinalize) wrote `typeof remoteVal === 'string'
// ? remoteVal : JSON.stringify(remoteVal)`, so a pre-coerced "[object Object]" string
// was written verbatim and re-applied every pull (sticky). Load paths JSON.parse +
// fall back to defaults, so the UI survives but the value never round-trips ->
// permanent settings-hash divergence.
//
// Fix (this file's unit surface):
//   _isCorruptObjectString  — corruption sentinel ("[object Object]" substring)
//   _safeSettingWriteValue  — compute the write string, or null to skip corruption
//   syncBootRepairCorruptSettings — one-time, idempotent removal of corrupt keys
//
// Loaded via slice-and-eval (mirrors storage-compression.test.js) with mock storage.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/cloud-sync.js", import.meta.url), "utf-8");
const start = src.indexOf("function _isCorruptObjectString");
const end = src.indexOf("function syncSaveOverrideBackup");
assert.ok(
  start !== -1 && end !== -1 && end > start,
  "could not locate boot-repair helper block in cloud-sync.js"
);
const block = src.slice(start, end);

function makeSandbox(seed, decompressFn) {
  const map = new Map(Object.entries(seed || {}));
  const localStorageMock = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  const SYNC_SCOPE_KEYS = [
    "metalInventory",
    "appTheme",
    "viewModalSectionConfig",
    "chipCustomGroups",
    "numistaViewFields",
  ];
  const __decompressIfNeeded = decompressFn || ((s) => s);
  const debugLog = () => {};
  const factory = new Function(
    "localStorage",
    "SYNC_SCOPE_KEYS",
    "__decompressIfNeeded",
    "debugLog",
    block +
      "\nreturn { _isCorruptObjectString, _safeSettingWriteValue, syncBootRepairCorruptSettings };"
  );
  const api = factory(localStorageMock, SYNC_SCOPE_KEYS, __decompressIfNeeded, debugLog);
  return { map, ...api };
}

describe("STRK-157 apply-path corruption guard", () => {
  test("_safeSettingWriteValue returns null for [object Object] corruption (skip, don't persist)", () => {
    const { _safeSettingWriteValue } = makeSandbox();
    assert.equal(_safeSettingWriteValue("[object Object]"), null);
    assert.equal(_safeSettingWriteValue("[object Object],[object Object]"), null);
  });

  test("_safeSettingWriteValue passes clean scalars and JSON through unchanged", () => {
    const { _safeSettingWriteValue } = makeSandbox();
    assert.equal(_safeSettingWriteValue("dark"), "dark");
    assert.equal(_safeSettingWriteValue('"dark"'), '"dark"');
    assert.equal(_safeSettingWriteValue('{"a":1}'), '{"a":1}');
  });

  test("_safeSettingWriteValue JSON-stringifies non-string objects/arrays", () => {
    const { _safeSettingWriteValue } = makeSandbox();
    assert.equal(_safeSettingWriteValue({ a: 1 }), '{"a":1}');
    assert.equal(_safeSettingWriteValue([{ a: 1 }, { b: 2 }]), '[{"a":1},{"b":2}]');
  });
});

describe("STRK-157 boot-repair for corrupt object-valued keys", () => {
  test("removes corrupt keys, leaves clean keys intact, reports what it repaired", () => {
    const sb = makeSandbox({
      appTheme: "dark",
      viewModalSectionConfig: "[object Object],[object Object]",
      chipCustomGroups: '{"valid":true}',
      numistaViewFields: "[object Object]",
    });
    const repaired = sb.syncBootRepairCorruptSettings();
    assert.deepEqual(
      repaired.slice().sort(),
      ["numistaViewFields", "viewModalSectionConfig"],
      "both corrupt keys reported"
    );
    assert.equal(sb.map.has("viewModalSectionConfig"), false, "corrupt key removed");
    assert.equal(sb.map.has("numistaViewFields"), false, "corrupt key removed");
    assert.equal(sb.map.get("appTheme"), "dark", "clean scalar untouched");
    assert.equal(sb.map.get("chipCustomGroups"), '{"valid":true}', "clean object untouched");
  });

  test("is idempotent: a second run finds nothing and is a no-op", () => {
    const sb = makeSandbox({
      appTheme: "dark",
      viewModalSectionConfig: "[object Object]",
    });
    const first = sb.syncBootRepairCorruptSettings();
    assert.deepEqual(first, ["viewModalSectionConfig"]);
    const second = sb.syncBootRepairCorruptSettings();
    assert.deepEqual(second, [], "no-op on second run");
    assert.equal(sb.map.get("appTheme"), "dark");
  });

  test("detects corruption hidden behind a compression marker (decompress first)", () => {
    const decompress = (s) => (s === "CMP2:corrupt" ? "[object Object]" : s);
    const sb = makeSandbox({ chipCustomGroups: "CMP2:corrupt", appTheme: "dark" }, decompress);
    const repaired = sb.syncBootRepairCorruptSettings();
    assert.deepEqual(repaired, ["chipCustomGroups"]);
    assert.equal(sb.map.has("chipCustomGroups"), false);
  });

  test("no corruption present -> empty result, nothing removed", () => {
    const sb = makeSandbox({ appTheme: "dark", chipCustomGroups: '{"ok":1}' });
    assert.deepEqual(sb.syncBootRepairCorruptSettings(), []);
    assert.equal(sb.map.size, 2);
  });
});

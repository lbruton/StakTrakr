// Unit tests for js/diff-modal-settings.js (STRK-181 split of diff-modal.js).
// Run: npm run test:unit  (node --test tests/unit/diff-modal-settings.test.js)
//
// The module is a browser IIFE that assigns window.DiffModalSettings. We load it
// via new Function() with an injected `window` object so the IIFE's
// `typeof window !== "undefined"` guard fires and exposes the public API without
// any DOM. sanitizeHtml / __decompressIfNeeded are intentionally left undefined
// so _esc falls back to its inline HTML-escape branch (deterministic output).
//
// Focus: the shared _renderDiffChip / _renderMatchedChip helpers must produce
// identical chip markup for both the chip-strip and toggle-map renderers, plus
// the slug-chips, count-summary, value-formatter and metal-color paths.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const code = readFileSync(new URL("../../js/diff-modal-settings.js", import.meta.url), "utf-8");
const window = {};
new Function("window", code)(window);
const DMS = window.DiffModalSettings;

describe("DiffModalSettings public API", () => {
  it("exposes the four documented methods", () => {
    assert.equal(typeof DMS.renderSettingRow, "function");
    assert.equal(typeof DMS.formatSettingValue, "function");
    assert.equal(typeof DMS.metalColor, "function");
    assert.equal(typeof DMS.metalBgGradient, "function");
  });

  it("returns null for a key with no rich renderer", () => {
    assert.equal(DMS.renderSettingRow("displayCurrency", "USD", "EUR"), null);
  });
});

describe("renderSettingRow — chip-strip", () => {
  const local = [{ id: "a", label: "Alpha", enabled: true }];
  const remote = [{ id: "a", label: "Alpha", enabled: false }];

  it("renders an enabled/disabled diff with both side chips", () => {
    const html = DMS.renderSettingRow("layoutSectionConfig", local, remote, {});
    assert.match(html, /dm-chip-local/);
    assert.match(html, /dm-chip-remote/);
    assert.match(html, /data-side="local"/);
    assert.match(html, /data-side="remote"/);
    assert.match(html, /Alpha/);
    assert.match(html, /✓/); // local enabled
    assert.match(html, /✗/); // remote disabled
    assert.match(html, /data-field="setting-layoutSectionConfig-a"/);
  });

  it("applies the dm-selected highlight from fieldSelections", () => {
    const sel = { "setting-layoutSectionConfig-a": "local" };
    const html = DMS.renderSettingRow("layoutSectionConfig", local, remote, sel);
    // Only the local side should carry dm-selected.
    assert.match(html, /dm-chip-local[^"]*dm-selected/);
    assert.doesNotMatch(html, /dm-chip-remote[^"]*dm-selected/);
  });

  it("renders a matched chip when both sides agree", () => {
    const same = [{ id: "a", label: "Alpha", enabled: true }];
    const html = DMS.renderSettingRow("layoutSectionConfig", same, same, {});
    assert.match(html, /dm-chip-matched/);
  });
});

describe("renderSettingRow — toggle-map shares chip markup with chip-strip", () => {
  it("emits the same chip classes/icons as chip-strip for an enabled/disabled diff", () => {
    const html = DMS.renderSettingRow("numistaViewFields", { fieldA: true }, { fieldA: false }, {});
    assert.match(html, /dm-chip-local dm-chip-enabled/);
    assert.match(html, /dm-chip-remote dm-chip-disabled/);
    assert.match(html, /data-side="local"/);
    assert.match(html, /✓/);
    assert.match(html, /✗/);
    // _titleCase humanizes the key.
    assert.match(html, /Field A/);
  });

  it("threads fieldSelections highlight through the shared helper", () => {
    const sel = { "setting-numistaViewFields-fieldA": "remote" };
    const html = DMS.renderSettingRow(
      "numistaViewFields",
      { fieldA: true },
      { fieldA: false },
      sel
    );
    assert.match(html, /dm-chip-remote[^"]*dm-selected/);
    assert.doesNotMatch(html, /dm-chip-local[^"]*dm-selected/);
  });
});

describe("renderSettingRow — slug-chips", () => {
  it("maps a slug to its human label from SLUG_LABELS", () => {
    const html = DMS.renderSettingRow("headerBtnOrder", ["themeBtn"], [], {});
    assert.match(html, /Theme/); // SLUG_LABELS.themeBtn
    assert.match(html, /dm-chip-local/);
  });

  it("falls back to Title Case for an unknown slug", () => {
    const html = DMS.renderSettingRow("headerBtnOrder", ["someCustomBtn"], [], {});
    assert.match(html, /Some Custom Btn/);
  });
});

describe("renderSettingRow — count-summary", () => {
  it("marks the chosen side active from conflictResolutions", () => {
    const conflicts = { "setting-chipCustomGroups": "remote" };
    const html = DMS.renderSettingRow("chipCustomGroups", { a: 1 }, { a: 1, b: 2 }, {}, conflicts);
    assert.match(html, /dm-count-summary/);
    assert.match(html, /data-side="remote"[^>]*>Use Remote/);
    // The remote button carries the active class.
    assert.match(
      html,
      /dm-count-btn active" data-setting-resolution="setting-chipCustomGroups" data-side="remote"/
    );
  });
});

describe("formatSettingValue", () => {
  it("masks configured API-key settings", () => {
    assert.equal(DMS.formatSettingValue("catalog_api_config", "secret"), "••• configured");
    assert.equal(DMS.formatSettingValue("catalog_api_config", ""), "not set");
  });

  // STRK-315: metalApiConfig no longer masks the whole blob as "configured" —
  // it holds the provider, cache and metal settings too, so a non-credential
  // change used to render identically to a key change. It now summarizes the
  // provider plus a key COUNT; key material is still never rendered. Full
  // coverage lives in strk-315-spot-api-usage-sync.test.js.
  it("summarizes metalApiConfig by provider and key count", () => {
    const cfg = JSON.stringify({ provider: "METALS_DEV", keys: { METALS_DEV: "FAKE-secret" } });
    const out = DMS.formatSettingValue("metalApiConfig", cfg);
    assert.match(out, /1 key/);
    assert.doesNotMatch(out, /FAKE-secret/);
    assert.equal(DMS.formatSettingValue("metalApiConfig", ""), "not set");
  });

  it("renders booleans, nulls, arrays, and objects", () => {
    assert.equal(DMS.formatSettingValue("x", true), "On");
    assert.equal(DMS.formatSettingValue("x", null), "—");
    assert.match(DMS.formatSettingValue("x", ["a", "b", "c"]), /^3 items \(a, b/);
    assert.equal(DMS.formatSettingValue("x", { a: 1, b: 2 }), "2 entries");
  });
});

describe("metal color helpers", () => {
  it("resolves known metals and falls back for unknown", () => {
    assert.equal(DMS.metalColor("gold"), "var(--gold)");
    assert.equal(DMS.metalColor("SILVER"), "var(--silver)");
    assert.equal(DMS.metalColor("unobtanium"), "var(--text-muted)");
  });

  it("builds an rgb-tinted gradient per metal", () => {
    assert.match(DMS.metalBgGradient("silver"), /192,192,192/);
    assert.match(DMS.metalBgGradient("platinum"), /229,228,226/);
    assert.match(DMS.metalBgGradient("unknown"), /128,128,128/);
  });
});

// Regression tests for STRK-246 — a bulk Type→Goldback coercion must inject the
// full goldback metadata bundle (weightUnit="gb" + metal="Gold" + the picked
// denomination as `weight`) into valuesToApply PAST the checkbox gate, mirroring
// STRK-238's applyBulkConstitutionalBundle.
//
// Why a bundle (not a bare weightUnit inject like Silverback): a `gb` item stores
// `weight` = the DENOMINATION NUMBER (1, 5, 10, …), and getGoldbackRetailPrice
// (js/utils.js) keys on `weightUnit === "gb"` then prices off parseFloat(weight).
// With only {type:"Goldback"} applied, the item keeps weightUnit="oz" and is a
// malformed goldback valued as plain oz — the conversion never takes effect. The
// bundle's price-relevant keys also re-arm recordBulkPriceHistory (the STRK-244
// gate that intentionally recorded nothing for the un-bundled goldback path).
//
// applyBulkGoldbackBundle is sliced out of source and evaluated with stubbed deps —
// the project's slice-and-eval idiom for no-export script-global modules (mirrors
// strk-244-valuation-history-gate.test.js). The sliced `fnSrc` is read from the
// repo's own js/ files, never external input.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bulkSrc = readFileSync(new URL("../../js/bulkEdit.js", import.meta.url), "utf-8");

// Slice an arrow-const function body bounded by the first column-0 "\n}" after its
// declaration head (every nested brace is indented, so "\n}" bounds it precisely).
function sliceArrowConst(src, declHead) {
  const start = src.indexOf(declHead);
  assert.ok(start !== -1, `could not locate "${declHead}" in source`);
  const end = src.indexOf("\n}", start) + 2;
  assert.ok(end > start + 1, `could not locate the end of "${declHead}"`);
  return src.slice(start, end);
}

// Goldback denominations as defined in js/constants.js — `weight` is the
// denomination NUMBER, not an oz weight. updateBulkDenomLabels defaults the bulk
// picker to the weight===1 ("1 Goldback") option.
const GOLDBACK_DENOMINATIONS = [
  { weight: 0.25, label: "¼ Goldback", goldOz: 0.00025 },
  { weight: 0.5, label: "½ Goldback", goldOz: 0.0005 },
  { weight: 1, label: "1 Goldback", goldOz: 0.001 },
  { weight: 5, label: "5 Goldback", goldOz: 0.005 },
  { weight: 50, label: "50 Goldback", goldOz: 0.05 },
];

// Minimal stand-in for the DOM <select> so the function's `instanceof
// HTMLSelectElement` guard (safeGetElement returns a truthy dummy on a miss — see
// the safeGetElement-truthy-dummy convention) resolves the same way it does live.
class FakeSelect {
  constructor(value) {
    this.value = value;
  }
}

function buildApplyBulkGoldbackBundle(denomSelect) {
  const fnSrc = sliceArrowConst(bulkSrc, "const applyBulkGoldbackBundle = (");
  const factory = new Function(
    "safeGetElement",
    "GOLDBACK_DENOMINATIONS",
    "HTMLSelectElement",
    fnSrc + "\nreturn applyBulkGoldbackBundle;"
  );
  // safeGetElement returns the provided fake denom select (or a non-select dummy
  // when null is passed, to exercise the instanceof guard's fallback path).
  const safeGetElement = () =>
    denomSelect === undefined ? { value: "ignored-dummy" } : denomSelect;
  return factory(safeGetElement, GOLDBACK_DENOMINATIONS, FakeSelect);
}

describe("STRK-246 — applyBulkGoldbackBundle injects a valid goldback bundle", () => {
  test("stages weightUnit='gb', metal='Gold', and the picked denomination as weight", () => {
    const valuesToApply = { type: "Goldback" };
    const apply = buildApplyBulkGoldbackBundle(new FakeSelect("5"));
    apply(valuesToApply);
    assert.equal(valuesToApply.weightUnit, "gb", "weightUnit coerced to gb");
    assert.equal(valuesToApply.metal, "Gold", "metal forced to Gold");
    assert.equal(valuesToApply.weight, "5", "weight = the picked denomination number");
  });

  test("defaults to the 1-Goldback denomination when the picker has no value", () => {
    const valuesToApply = { type: "Goldback" };
    const apply = buildApplyBulkGoldbackBundle(new FakeSelect(""));
    apply(valuesToApply);
    assert.equal(valuesToApply.weightUnit, "gb");
    assert.equal(valuesToApply.weight, "1", "empty picker falls back to the 1-Goldback default");
  });

  test("defaults to the 1-Goldback denomination when the picker element is absent", () => {
    // safeGetElement returns a non-select dummy → instanceof guard yields null →
    // the GOLDBACK_DENOMINATIONS default (weight===1) is used, never a 0/NaN weight.
    const valuesToApply = { type: "Goldback" };
    const apply = buildApplyBulkGoldbackBundle(undefined);
    apply(valuesToApply);
    assert.equal(valuesToApply.weightUnit, "gb");
    assert.equal(valuesToApply.metal, "Gold");
    assert.equal(valuesToApply.weight, "1", "absent picker falls back to the 1-Goldback default");
  });
});

// Non-regression: the bundle's injected keys must remain price-relevant so the
// STRK-244 recordBulkPriceHistory gate fires for a bulk Type→Goldback (which has
// only {type} checked). Guards against weight/weightUnit/metal being dropped from
// recordBulkPriceHistory's priceFields, which would re-stale the value chart.
describe("STRK-246 — the injected gb bundle re-arms the STRK-244 recording gate", () => {
  function buildRecordBulkPriceHistory(env) {
    const fnSrc = sliceArrowConst(bulkSrc, "const recordBulkPriceHistory = (");
    const factory = new Function(
      "recordItemPrice",
      "bulkEnabledFields",
      "inventory",
      "bulkSelection",
      "saveItemPriceHistory",
      fnSrc + "\nreturn recordBulkPriceHistory;"
    );
    return factory(
      env.recordItemPrice,
      env.bulkEnabledFields,
      env.inventory,
      env.bulkSelection,
      env.saveItemPriceHistory
    );
  }

  test("Type→Goldback (only 'type' enabled) records once the bundle is injected", () => {
    const recorded = [];
    let saved = 0;
    const inv = [
      { uuid: "g1", serial: 1 },
      { uuid: "g2", serial: 2 },
    ];
    const env = {
      recordItemPrice: (item, trigger) => {
        recorded.push({ uuid: item.uuid, trigger });
        return true;
      },
      bulkEnabledFields: new Set(["type"]),
      inventory: inv,
      bulkSelection: new Set(inv.map((i) => String(i.serial))),
      saveItemPriceHistory: () => {
        saved += 1;
      },
    };

    // Reproduce the apply path: collected {type:"Goldback"} → bundle injection.
    const valuesToApply = { type: "Goldback" };
    buildApplyBulkGoldbackBundle(new FakeSelect("5"))(valuesToApply);

    buildRecordBulkPriceHistory(env)(valuesToApply);
    assert.equal(recorded.length, 2, "both selected items get a bulk price-history point");
    assert.ok(recorded.every((r) => r.trigger === "bulk"));
    assert.equal(saved, 1, "the price-history change is persisted once");
  });
});

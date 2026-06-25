// Regression tests for STRK-244 — valuation-affecting changes made via "injected
// fields" (constitutional denomination/variant swaps, Type→cu/gb/sb coercions)
// must still trigger item-price-history recording, so the per-item value chart
// does not go stale until a later price edit.
//
// Two detection sites gate the recording, and both omitted the constitutional
// metadata before this fix:
//   1. Single edit — `valuationFieldChanged(oldItem, newItem)` (js/events.js),
//      the predicate behind the commitItemToInventory price-history gate.
//   2. Bulk edit — `recordBulkPriceHistory(valuesToApply)` (js/bulkEdit.js), which
//      must fire when a Type-coercion injects valuation fields PAST the checkbox
//      gate (the STRK-238 pattern), not only when a price-relevant checkbox was on.
//
// Both functions are sliced out of source and evaluated with stubbed deps — the
// project's slice-and-eval idiom for no-export script-global modules (mirrors
// cloud-sync-constitutional-hash.test.js). The sliced `fnSrc` is read from the
// repo's own js/ files, never external input.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const eventsSrc = readFileSync(new URL("../../js/events.js", import.meta.url), "utf-8");
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

function buildValuationFieldChanged() {
  const fnSrc = sliceArrowConst(eventsSrc, "const valuationFieldChanged = (oldItem, newItem) => {");
  return new Function(fnSrc + "\nreturn valuationFieldChanged;")();
}

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

describe("STRK-244 — single-edit valuation gate covers injected fields", () => {
  test("a junk-silver denomination swap with identical facePerCoin is detected", () => {
    // con-90-half → con-40-half: both facePerCoin 0.5 (stored `weight` unchanged),
    // but the 90%→40% variant swings melt ~2.4x. Only constitutionalVariant changes,
    // so the legacy marketValue/price/weight/qty/metal/purity gate misses it.
    const valuationFieldChanged = buildValuationFieldChanged();
    const oldItem = {
      uuid: "u1",
      weightUnit: "cu",
      weight: 0.5,
      qty: 10,
      metal: "Silver",
      purity: 0.9,
      marketValue: 0,
      price: 0,
      constitutionalEntryMode: "denom",
      constitutionalVariant: "con-90-half",
    };
    const newItem = { ...oldItem, constitutionalVariant: "con-40-half" };
    assert.equal(valuationFieldChanged(oldItem, newItem), true);
  });

  test("an entry-mode swap (denom↔face) is detected", () => {
    const valuationFieldChanged = buildValuationFieldChanged();
    const oldItem = {
      uuid: "u2",
      weightUnit: "cu",
      weight: 1,
      qty: 1,
      metal: "Silver",
      purity: 0.9,
      constitutionalEntryMode: "denom",
      constitutionalVariant: "con-90-dollar",
    };
    const newItem = { ...oldItem, constitutionalEntryMode: "face" };
    assert.equal(valuationFieldChanged(oldItem, newItem), true);
  });

  test("a Type→cu/gb/sb coercion (weightUnit change) is detected", () => {
    const valuationFieldChanged = buildValuationFieldChanged();
    const oldItem = {
      uuid: "u3",
      weightUnit: "oz",
      weight: 1,
      qty: 1,
      metal: "Silver",
      purity: 0.999,
    };
    assert.equal(valuationFieldChanged(oldItem, { ...oldItem, weightUnit: "cu" }), true);
  });

  test("a legacy marketValue change is still detected (non-regression)", () => {
    const valuationFieldChanged = buildValuationFieldChanged();
    const oldItem = {
      uuid: "u4",
      weightUnit: "oz",
      weight: 1,
      qty: 1,
      metal: "Silver",
      purity: 0.999,
      marketValue: 0,
    };
    assert.equal(valuationFieldChanged(oldItem, { ...oldItem, marketValue: 50 }), true);
  });

  test("a non-valuation edit (notes/name only) is NOT a valuation change", () => {
    const valuationFieldChanged = buildValuationFieldChanged();
    const oldItem = {
      uuid: "u5",
      weightUnit: "oz",
      weight: 1,
      qty: 1,
      metal: "Silver",
      purity: 0.999,
      notes: "a",
      name: "x",
    };
    assert.equal(valuationFieldChanged(oldItem, { ...oldItem, notes: "b", name: "y" }), false);
  });
});

describe("STRK-244 — bulk guard records on Type-coercion-injected valuation fields", () => {
  function makeEnv({ enabled, inventory }) {
    const recorded = [];
    let saved = 0;
    const env = {
      recordItemPrice: (item, trigger) => {
        recorded.push({ uuid: item.uuid, trigger });
        return true;
      },
      bulkEnabledFields: new Set(enabled),
      inventory,
      bulkSelection: new Set(inventory.map((i) => String(i.serial))),
      saveItemPriceHistory: () => {
        saved += 1;
      },
    };
    return { env, recorded, getSaved: () => saved };
  }

  const inv = [
    { uuid: "a", serial: 1 },
    { uuid: "b", serial: 2 },
  ];

  test("Type→Constitutional with only 'type' enabled records via injected valuesToApply", () => {
    // bulkEnabledFields stays {type}, but applyBulkConstitutionalBundle injects the
    // valuation fields into valuesToApply past the checkbox gate — recording must fire.
    const { env, recorded } = makeEnv({ enabled: ["type"], inventory: inv });
    const recordBulkPriceHistory = buildRecordBulkPriceHistory(env);
    recordBulkPriceHistory({
      type: "Constitutional",
      weightUnit: "cu",
      metal: "Silver",
      weight: "0.5",
      constitutionalEntryMode: "denom",
      constitutionalVariant: "con-90-half",
    });
    assert.equal(recorded.length, 2, "both selected items get a bulk price-history point");
    assert.ok(
      recorded.every((r) => r.trigger === "bulk"),
      "recorded with the 'bulk' trigger"
    );
  });

  test("a non-price bulk edit (notes only) records nothing", () => {
    const { env, recorded } = makeEnv({ enabled: ["notes"], inventory: inv });
    const recordBulkPriceHistory = buildRecordBulkPriceHistory(env);
    recordBulkPriceHistory({ notes: "hello" });
    assert.equal(recorded.length, 0);
  });

  test("a legacy price-field checkbox still records (non-regression)", () => {
    const { env, recorded } = makeEnv({ enabled: ["marketValue"], inventory: inv });
    const recordBulkPriceHistory = buildRecordBulkPriceHistory(env);
    recordBulkPriceHistory({ marketValue: "100" });
    assert.equal(recorded.length, 2);
  });
});

// Unit tests for per-unit Collection valuation (STRK-382, epic STRK-381).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sliceArrowConst } from "./test-helpers.js";

const src = readFileSync(new URL("../../js/utils.js", import.meta.url), "utf-8");

const computeItemUnitValuation = new Function(
  "computeMeltValue",
  "isGoldbackPricingActive",
  "getGoldbackDenominationPrice",
  [
    sliceArrowConst(src, "const getGoldbackRetailPrice = ("),
    sliceArrowConst(src, "const calculateRetailPrice = ("),
    sliceArrowConst(src, "const computeItemValuation = ("),
    sliceArrowConst(src, "const computeItemUnitValuation = ("),
  ].join("\n") + "\nreturn computeItemUnitValuation;"
)(
  (item, spot) =>
    (Number(item.weight) || 0) * (Number(item.qty) || 1) * spot * (Number(item.purity) || 1),
  () => false,
  () => null
);

describe("computeItemUnitValuation", () => {
  test("uses manual retail even when it is below melt and normalizes quantity", () => {
    const valuation = computeItemUnitValuation(
      { qty: 2, price: 30, marketValue: 20, weight: 1, weightUnit: "oz", purity: 1 },
      40
    );

    assert.equal(valuation.retailUnitPrice, 20);
    assert.equal(valuation.gainLossUnit, -10);
    assert.equal(valuation.hasRetailSignal, true);
    assert.equal(valuation.isManualRetail, true);
  });

  test("falls back to melt and computes gain/loss per unit", () => {
    const valuation = computeItemUnitValuation(
      { qty: 2, price: 25, marketValue: 0, weight: 1, weightUnit: "oz", purity: 1 },
      40
    );

    assert.equal(valuation.retailUnitPrice, 40);
    assert.equal(valuation.gainLossUnit, 15);
    assert.equal(valuation.hasRetailSignal, true);
    assert.equal(valuation.isManualRetail, false);
  });

  test("uses the Goldback denomination price from the inventory hierarchy", () => {
    const goldbackValuation = new Function(
      "computeMeltValue",
      "isGoldbackPricingActive",
      "getGoldbackDenominationPrice",
      [
        sliceArrowConst(src, "const getGoldbackRetailPrice = ("),
        sliceArrowConst(src, "const calculateRetailPrice = ("),
        sliceArrowConst(src, "const computeItemValuation = ("),
        sliceArrowConst(src, "const computeItemUnitValuation = ("),
      ].join("\n") + "\nreturn computeItemUnitValuation;"
    )(
      (item, spot) => (Number(item.weight) || 0) * (Number(item.qty) || 1) * spot,
      () => true,
      (denomination) => (denomination === 5 ? 60 : null)
    );
    const valuation = goldbackValuation(
      {
        qty: 2,
        price: 40,
        marketValue: 50,
        weight: 5,
        weightUnit: "gb",
        metal: "Gold",
        purity: 0.999,
      },
      100
    );

    assert.equal(valuation.retailUnitPrice, 60);
    assert.equal(valuation.gbDenomPrice, 60);
    assert.equal(valuation.isManualRetail, false);
  });

  test("has no gain/loss signal when retail and spot are both unavailable", () => {
    const valuation = computeItemUnitValuation(
      { qty: 1, price: 25, marketValue: 0, weight: 1, weightUnit: "oz", purity: 1 },
      0
    );

    assert.equal(valuation.retailUnitPrice, 0);
    assert.equal(valuation.gainLossUnit, null);
    assert.equal(valuation.hasRetailSignal, false);
  });
});

// Unit tests for js/utils.js buildCsvValueCells — the shared 15-cell CSV value-column
// builder (STRK-227, extended by STRK-235 to add constitutionalVariant + constitutionalEntryMode).
//
// buildCsvValueCells is the single source of truth consumed by BOTH the full inventory
// CSV export (csv-export.js) and the backup ZIP CSV (inventory-backup.js). Before STRK-227
// the identical logic lived in two near-clone builders (buildCsvValueColumns and
// _backupCsvValueCells), so the STRK-211/212 crash class had to be guarded in both. These
// tests lock the cell order and the missing-metal / non-numeric-weight guards so the two
// exporters can never drift again.
//
// Harness: buildCsvValueCells is a module-internal `const` arrow (also window/module
// exported), referencing the globals spotPrices / computeItemValuation / computeMeltValue /
// formatCurrency. We slice it from source and evaluate it with those collaborators injected,
// mirroring tests/unit/filters-tally-and-guards.test.js.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/utils.js", import.meta.url), "utf-8");

/** Slice a named `const NAME = (...) => { ... };` block (col-0 terminator) out of the source. */
function sliceConst(name) {
  const re = new RegExp(`const ${name} = \\([\\s\\S]*?\\n\\};`);
  const m = src.match(re);
  assert.ok(m, `could not locate ${name} in js/utils.js`);
  return m[0];
}

const fmt = (n) => `$${Number(n).toFixed(2)}`;

/**
 * Builds an isolated buildCsvValueCells with all four collaborators injected.
 * @param {object} spotPrices - metal→price map (drives the melt placeholder branch)
 * @param {Function} computeItemValuation - valuation stub (return null to force legacy fallback)
 * @param {Function} computeMeltValue - melt stub used only on the fallback path
 * @returns {(item: object) => Array} The isolated buildCsvValueCells
 */
function build(spotPrices, computeItemValuation, computeMeltValue) {
  return new Function(
    "spotPrices",
    "computeItemValuation",
    "computeMeltValue",
    "formatCurrency",
    sliceConst("buildCsvValueCells") + "\nreturn buildCsvValueCells;"
  )(spotPrices, computeItemValuation, computeMeltValue, fmt);
}

describe("utils.js buildCsvValueCells — valuation path (STRK-227)", () => {
  const fn = build(
    { silver: 30 },
    () => ({ purchasePrice: 25, meltValue: 28, gainLoss: 3 }),
    () => {
      throw new Error("computeMeltValue must NOT be called when a valuation is present");
    }
  );

  test("emits the 15 value cells in BACKUP_CSV_HEADERS[0..14] order (STRK-235 adds constitutional columns)", () => {
    const cells = fn({
      date: "2026-01-01",
      metal: "Silver",
      type: "Coin",
      name: "American Silver Eagle",
      year: 2021,
      qty: 2,
      weight: "1",
      weightUnit: "oz",
      purity: "0.999",
      marketValue: 56,
    });
    assert.deepEqual(cells, [
      "2026-01-01", // date
      "Silver", // metal
      "Coin", // type
      "American Silver Eagle", // name
      2021, // year
      2, // qty
      "1.0000", // weight (4dp)
      "oz", // weightUnit
      "", // constitutionalVariant (STRK-235)
      "", // constitutionalEntryMode (STRK-235)
      0.999, // purity
      "$25.00", // purchase price (from valuation)
      "$28.00", // melt value (currentSpot > 0)
      "$56.00", // market value
      "$3.00", // gain/loss (from valuation)
    ]);
  });
});

describe("utils.js buildCsvValueCells — degenerate item guards (STRK-211/212 class)", () => {
  // No spot prices → currentSpot is 0 for any metal; valuation forced null → legacy fallback.
  const fn = build(
    {},
    () => null,
    () => 0
  );

  test("missing metal / non-numeric weight serialize as Silver / 0.0000 without throwing", () => {
    let cells;
    assert.doesNotThrow(() => {
      cells = fn({ date: "", name: "mystery" }); // no metal, weight, qty, purity, marketValue
    });
    assert.equal(cells[1], "Silver", "missing metal defaults to Silver");
    assert.equal(cells[6], "0.0000", "non-numeric weight guards to 0.0000");
    // Indices 8 and 9 are constitutionalVariant and constitutionalEntryMode (STRK-235)
    assert.equal(cells[10], 1, "missing purity defaults to 1.0");
    assert.equal(cells[12], "—", "currentSpot 0 → melt placeholder em dash");
    assert.equal(cells[13], "$0.00", "missing marketValue → $0.00");
    assert.equal(cells[14], "—", "null gainLoss → em dash placeholder");
  });
});

// ---------------------------------------------------------------------------
// STRK-235 — sanitizeImportedItem / sanitizeObjectFields constitutional round-trip
// Verifies that constitutional metadata (variant + entryMode) survives the
// sanitize pipeline intact (hyphenated variant id must NOT be stripped, and
// entryMode must NOT be stripped by sanitizeObjectFields).
// ---------------------------------------------------------------------------
describe("utils.js sanitizeImportedItem — STRK-235 constitutional field round-trip", () => {
  // Slice both sanitize helpers from utils.js.  sanitizeImportedItem depends on:
  //   cleanString, stripNonAlphanumeric, normalizeType, sanitizeObjectFields.
  // We extract each in dependency order and build them in a shared eval context.

  function sliceFn(name) {
    // Match `const name = ...;` or `function name(...) {...}` blocks.
    const reConst = new RegExp(`const ${name} = (?:function |\\()[\\s\\S]*?\\n\\};`);
    const reFn = new RegExp(`function ${name}\\s*\\([\\s\\S]*?\\n\\}`);
    const m = src.match(reConst) || src.match(reFn);
    if (!m) throw new Error(`could not locate ${name} in js/utils.js`);
    return m[0];
  }

  // Needed globals that sanitizeImportedItem may reference:
  const stubGlobals = `
    const cleanString = (s = "") => s.toString().trim().replace(/[\\u0000-\\u001F\\u007F]/g,"");
    const stripNonAlphanumeric = (s = "", opts = {}) => {
      const str = s.toString();
      if (opts.allowHyphen) return str.replace(/[^a-zA-Z0-9 .\\-]/g, "").trim();
      return str.replace(/[^a-zA-Z0-9 .]/g, "").trim();
    };
    const normalizeType = (t = "") => t.toString().trim();
    const parseFloat = globalThis.parseFloat;
  `;

  const sanitizeObjSrc = sliceFn("sanitizeObjectFields");
  const sanitizeItemSrc = sliceFn("sanitizeImportedItem");

  const evalSanitize = new Function(
    stubGlobals +
      sanitizeObjSrc +
      sanitizeItemSrc +
      "\nreturn { sanitizeObjectFields, sanitizeImportedItem };"
  );
  const { sanitizeObjectFields, sanitizeImportedItem } = evalSanitize();

  test("constitutionalVariant hyphenated id survives sanitizeObjectFields", () => {
    const result = sanitizeObjectFields({
      name: "Junk Silver",
      weightUnit: "cu",
      constitutionalVariant: "con-90-quarter",
      constitutionalEntryMode: "denom",
      date: "2026-01-15",
    });
    assert.equal(
      result.constitutionalVariant,
      "con-90-quarter",
      "hyphens in constitutionalVariant must NOT be stripped"
    );
    assert.equal(
      result.constitutionalEntryMode,
      "denom",
      "constitutionalEntryMode must survive sanitizeObjectFields"
    );
  });

  test("sanitizeImportedItem preserves constitutionalVariant + constitutionalEntryMode on a cu item", () => {
    const raw = {
      metal: "Silver",
      composition: "Silver",
      name: "90% Junk Silver",
      qty: 40,
      type: "Constitutional",
      weight: 0,
      weightUnit: "cu",
      purity: 1.0,
      price: 2.5,
      constitutionalVariant: "con-90-quarter",
      constitutionalEntryMode: "denom",
      serial: 1,
      uuid: "00000000-0000-0000-0000-000000000001",
    };
    const item = sanitizeImportedItem(raw);
    assert.equal(
      item.constitutionalVariant,
      "con-90-quarter",
      "variant must survive sanitizeImportedItem (hyphen-id round-trip)"
    );
    assert.equal(
      item.constitutionalEntryMode,
      "denom",
      "entryMode must survive sanitizeImportedItem"
    );
    assert.equal(item.weightUnit, "cu", "weightUnit must be preserved as cu");
  });
});

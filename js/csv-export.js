// CSV EXPORT (STRK-169)
// =============================================================================
// Standard + Numista-format CSV export for the inventory. Extracted verbatim
// from js/inventory-import.js to keep each file under the Codacy Lizard
// file-nloc gate (1500). Pure code motion — no behavior change. Self-contained:
// reads only external globals (inventory, Papa, formatCurrency, spotPrices, and
// the valuation/format helpers from utils.js) at call time, with no dependency
// on inventory-import.js's IIFE-private state. Wrapped in its own strict-mode
// IIFE to preserve scope and re-expose the same window.* API the import file
// used. Decoupled from inventory-import.js — neither references the other.
// =============================================================================

(function () {
  "use strict";

  /**
   * Returns the Numista-format CSV header row.
   * @returns {string[]} Column titles in Numista import order.
   */
  const buildNumistaHeaders = () => [
    "N# number",
    "Title",
    "Year",
    "Metal",
    "Quantity",
    "Type",
    "Weight (g)",
    `Buying price (${displayCurrency})`,
    "Acquisition place",
    "Storage location",
    "Acquisition date",
    "Note",
    "Private comment",
    "Public comment",
    "Comment",
  ];

  /**
   * Formats an item's purchase price for the Numista "Buying price" column.
   *
   * STRK-88 (D-6): Convert internal USD price to display currency to match the
   * column header "Buying price (${displayCurrency})". The importer reads this
   * column and calls convertToUsd(amount, headerCurrency), so exporting raw USD
   * under a non-USD header causes round-trip inflation.
   * @param {object} item - Inventory item.
   * @param {number} fxRate - USD→displayCurrency exchange rate.
   * @param {number} fracDigits - Fraction-digit count for displayCurrency.
   * @returns {string} Converted price string, or "" when not numeric.
   */
  const formatNumistaBuyingPrice = (item, fxRate, fracDigits) => {
    const purchasePrice = item.purchasePrice ?? item.price;
    if (purchasePrice === null || purchasePrice === undefined) return "";
    const usdVal = Number(purchasePrice);
    if (isNaN(usdVal)) return "";
    return (usdVal * fxRate).toFixed(fracDigits);
  };

  /**
   * Triggers a browser download for the given CSV text.
   * @param {string} csv - The serialized CSV content.
   * @param {string} filename - Suggested download filename.
   */
  const downloadCsv = (csv, filename) => {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * Exports inventory using Numista-compatible column layout
   */
  const exportNumistaCsv = () => {
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const headers = buildNumistaHeaders();

    const sortedInventory = sortInventoryByDateNewestFirst();
    const fxRate = typeof getExchangeRate === "function" ? getExchangeRate(displayCurrency) : 1;
    const fracDigits =
      typeof getCurrencyFractionDigits === "function"
        ? getCurrencyFractionDigits(displayCurrency)
        : 2;

    const rows = sortedInventory.map((item) => buildNumistaRow(item, fxRate, fracDigits));

    const csv = Papa.unparse([headers, ...rows]);
    downloadCsv(csv, `numista_export_${timestamp}.csv`);
  };

  /**
   * Returns the standard-export CSV header row.
   * @returns {string[]} Column titles in standard export order.
   */
  const buildStandardHeaders = () => [
    "Date",
    "Metal",
    "Type",
    "Name",
    "Year",
    "Qty",
    "Weight(oz)",
    "Weight Unit",
    "Constitutional Variant",
    "Constitutional Entry Mode",
    "Purity",
    "Purchase Price",
    "Melt Value",
    "Retail Price",
    "Gain/Loss",
    "Payment Method",
    "Purchase Location",
    "Storage Location",
    "N#",
    "PCGS #",
    "Grade",
    "Grading Authority",
    "Cert #",
    "Serial Number",
    "Notes",
    "Tags",
    "removedTags",
    "UUID",
    "Obverse Image URL",
    "Reverse Image URL",
    "Obverse Frame",
    "Reverse Frame",
    "Disposition Type",
    "Disposition Date",
    "Disposition Amount",
    "Realized Gain/Loss",
    "Disposition Recipient",
    "Disposition Notes",
    "Disposition Currency",
    "Disposition DisposedAt",
    "Disposition Split From UUID",
    "Traded For UUIDs",
    "Traded From UUID",
  ];

  /**
   * Builds the catalog/identity columns (Payment Method … Reverse Frame).
   * @param {object} i - Inventory item.
   * @param {object} removedTagsMap - Map of uuid → removed-tag arrays.
   * @returns {Array<string>} The Payment-Method-through-Reverse-Frame cells.
   */
  const buildCsvCatalogColumns = (i, removedTagsMap) => [
    i.paymentMethod || "",
    i.purchaseLocation,
    i.storageLocation || "",
    i.numistaId || "",
    i.pcgsNumber || "",
    i.grade || "",
    i.gradingAuthority || "",
    i.certNumber || "",
    i.serialNumber || "",
    i.notes || "",
    typeof getItemTags === "function" ? getItemTags(i.uuid).join("; ") : "",
    Array.isArray(removedTagsMap[i.uuid]) ? removedTagsMap[i.uuid].join("; ") : "",
    i.uuid || "",
    i.obverseImageUrl || "",
    i.reverseImageUrl || "",
    i.obverseImageFrame || "",
    i.reverseImageFrame || "",
  ];

  /**
   * Builds the disposition/trade columns (Disposition Type … Traded From UUID).
   * @param {object} i - Inventory item.
   * @returns {Array<string|number>} The disposition-through-trade cells.
   */
  const buildCsvDispositionColumns = (i) => [
    i.disposition ? DISPOSITION_TYPES[i.disposition.type]?.label || i.disposition.type : "",
    i.disposition?.date || "",
    i.disposition ? i.disposition.amount || 0 : "",
    i.disposition ? i.disposition.realizedGainLoss || 0 : "",
    i.disposition?.recipient || "",
    i.disposition?.notes || "",
    i.disposition?.currency || "",
    i.disposition?.disposedAt || "",
    i.disposition?.splitFromUuid || "",
    Array.isArray(i.disposition?.tradedForUuids) ? i.disposition.tradedForUuids.join(",") : "",
    i.tradedFromUuid || "",
  ];

  /**
   * Assembles the full standard CSV row for one item from its column groups.
   * @param {object} i - Inventory item.
   * @param {object} removedTagsMap - Map of uuid → removed-tag arrays.
   * @returns {Array<string|number>} The complete ordered cell array.
   */
  const buildCsvRow = (i, removedTagsMap) => [
    ...buildCsvValueCells(i),
    ...buildCsvCatalogColumns(i, removedTagsMap),
    ...buildCsvDispositionColumns(i),
  ];

  /**
   * Exports current inventory to CSV format
   */
  const buildCsvContent = () => {
    if (typeof Papa === "undefined") return null;
    const headers = buildStandardHeaders();

    const sortedInventory = sortInventoryByDateNewestFirst();
    const _removedTagsMap =
      typeof loadDataSync === "function" ? loadDataSync("itemRemovedTags", {}) : {};

    const rows = sortedInventory.map((i) => buildCsvRow(i, _removedTagsMap));

    const _csvOrigin =
      typeof window !== "undefined" && window.location ? window.location.origin : "";
    const _originComment = "# exportOrigin: " + _csvOrigin + "\n";
    return _originComment + Papa.unparse([headers, ...rows]);
  };

  const exportCsv = () => {
    if (typeof Papa === "undefined") {
      appAlert(
        "CSV library (PapaParse) failed to load. Please check your internet connection and reload the page."
      );
      return;
    }
    debugLog("exportCsv start", inventory.length, "items");
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const csv = buildCsvContent();
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `metal_inventory_${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    debugLog("exportCsv complete");
  };

  window.exportCsv = exportCsv;
  window.exportInventoryCSV = buildCsvContent;
  window.exportNumistaCsv = exportNumistaCsv;

  // ---------------------------------------------------------------------------
  // Regex-heavy helpers kept LAST: Lizard's tokenizer desyncs on regex literals
  // and can roll their complexity into the following function, so they trail the
  // file (after the window.* exports) to dissolve any phantom rollup.
  // ---------------------------------------------------------------------------

  /**
   * Strips a leading/embedded year token from an item title for Numista export.
   * @param {string} title - The raw item title.
   * @param {string|number} year - The year to remove (escaped before matching).
   * @returns {string} The title with the year token removed and trimmed.
   */
  const stripYearFromTitle = (title, year) => {
    if (!year) return title;
    const yearRegex = new RegExp(`\\s*${String(year).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    return title.replace(yearRegex, "").trim();
  };

  /**
   * Splits an item's notes into base note plus typed comment fields for Numista.
   * @param {string} notes - The raw multi-line notes value.
   * @returns {{baseNote: string, privateComment: string, publicComment: string, otherComment: string}}
   *   The parsed note components.
   */
  const parseNumistaNotes = (notes) => {
    let baseNote = "";
    let privateComment = "";
    let publicComment = "";
    let otherComment = "";
    if (notes) {
      const lines = String(notes).split(/\n/);
      for (const line of lines) {
        if (/^\s*Private Comment:/i.test(line)) {
          privateComment = line.replace(/^\s*Private Comment:\s*/i, "").trim();
        } else if (/^\s*Public Comment:/i.test(line)) {
          publicComment = line.replace(/^\s*Public Comment:\s*/i, "").trim();
        } else if (/^\s*Comment:/i.test(line)) {
          otherComment = line.replace(/^\s*Comment:\s*/i, "").trim();
        } else {
          baseNote = baseNote ? `${baseNote}\n${line}` : line;
        }
      }
    }
    return { baseNote, privateComment, publicComment, otherComment };
  };

  /**
   * Builds a single Numista-format CSV row for one inventory item.
   * @param {object} item - Inventory item.
   * @param {number} fxRate - USD→displayCurrency exchange rate.
   * @param {number} fracDigits - Fraction-digit count for displayCurrency.
   * @returns {Array<string|number>} The ordered Numista cell array.
   */
  const buildNumistaRow = (item, fxRate, fracDigits) => {
    const year = item.year || item.issuedYear || "";
    const title = stripYearFromTitle(item.name || "", year);
    const weightGrams = parseFloat(item.weight) ? parseFloat(item.weight) * 31.1034768 : 0;
    const { baseNote, privateComment, publicComment, otherComment } = parseNumistaNotes(item.notes);

    return [
      item.numistaId || "",
      title,
      year,
      item.metal || "",
      item.qty || "",
      item.type || "",
      weightGrams ? weightGrams.toFixed(2) : "",
      formatNumistaBuyingPrice(item, fxRate, fracDigits),
      item.purchaseLocation || "",
      item.storageLocation || "",
      item.date || "",
      baseNote,
      privateComment,
      publicComment,
      otherComment,
    ];
  };
})();

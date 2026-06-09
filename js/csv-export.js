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
   * Exports inventory using Numista-compatible column layout
   */
  const exportNumistaCsv = () => {
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const headers = [
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

    const sortedInventory = sortInventoryByDateNewestFirst();
    const rows = [];
    const fxRate = typeof getExchangeRate === "function" ? getExchangeRate(displayCurrency) : 1;
    const fracDigits =
      typeof getCurrencyFractionDigits === "function"
        ? getCurrencyFractionDigits(displayCurrency)
        : 2;

    for (const item of sortedInventory) {
      const year = item.year || item.issuedYear || "";
      let title = item.name || "";
      if (year) {
        const yearRegex = new RegExp(
          `\\s*${String(year).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
        );
        title = title.replace(yearRegex, "").trim();
      }

      const weightGrams = parseFloat(item.weight) ? parseFloat(item.weight) * 31.1034768 : 0;
      const purchasePrice = item.purchasePrice ?? item.price;

      let baseNote = "";
      let privateComment = "";
      let publicComment = "";
      let otherComment = "";
      if (item.notes) {
        const lines = String(item.notes).split(/\n/);
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

      rows.push([
        item.numistaId || "",
        title,
        year,
        item.metal || "",
        item.qty || "",
        item.type || "",
        weightGrams ? weightGrams.toFixed(2) : "",
        // STRK-88 (D-6): Convert internal USD price to display currency to match the
        // column header "Buying price (${displayCurrency})". The importer reads this column
        // and calls convertToUsd(amount, headerCurrency), so exporting raw USD under a
        // non-USD header causes round-trip inflation.
        (() => {
          if (purchasePrice === null || purchasePrice === undefined) return "";
          const usdVal = Number(purchasePrice);
          if (isNaN(usdVal)) return "";
          return (usdVal * fxRate).toFixed(fracDigits);
        })(),
        item.purchaseLocation || "",
        item.storageLocation || "",
        item.date || "",
        baseNote,
        privateComment,
        publicComment,
        otherComment,
      ]);
    }

    const csv = Papa.unparse([headers, ...rows]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `numista_export_${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * Exports current inventory to CSV format
   */
  const buildCsvContent = () => {
    if (typeof Papa === "undefined") return null;
    const headers = [
      "Date",
      "Metal",
      "Type",
      "Name",
      "Year",
      "Qty",
      "Weight(oz)",
      "Weight Unit",
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

    const sortedInventory = sortInventoryByDateNewestFirst();
    const _removedTagsMap =
      typeof loadDataSync === "function" ? loadDataSync("itemRemovedTags", {}) : {};
    const rows = [];

    for (const i of sortedInventory) {
      const currentSpot = spotPrices[i.metal.toLowerCase()] || 0;
      const valuation =
        typeof computeItemValuation === "function" ? computeItemValuation(i, currentSpot) : null;
      const purchasePrice = valuation
        ? valuation.purchasePrice
        : typeof i.price === "number"
          ? i.price
          : parseFloat(i.price) || 0;
      const meltValue = valuation ? valuation.meltValue : computeMeltValue(i, currentSpot);
      const gainLoss = valuation ? valuation.gainLoss : null;

      rows.push([
        i.date,
        i.metal || "Silver",
        i.type,
        i.name,
        i.year || "",
        i.qty,
        parseFloat(i.weight).toFixed(4),
        i.weightUnit || "oz",
        parseFloat(i.purity) || 1.0,
        formatCurrency(purchasePrice),
        currentSpot > 0 ? formatCurrency(meltValue) : "—",
        formatCurrency(i.marketValue || 0),
        gainLoss !== null ? formatCurrency(gainLoss) : "—",
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
        Array.isArray(_removedTagsMap[i.uuid]) ? _removedTagsMap[i.uuid].join("; ") : "",
        i.uuid || "",
        i.obverseImageUrl || "",
        i.reverseImageUrl || "",
        i.obverseImageFrame || "",
        i.reverseImageFrame || "",
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
      ]);
    }

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
})();

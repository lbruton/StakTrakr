// SORTING FUNCTIONALITY
// =============================================================================

/**
 * Sorts inventory based on the current sort column and direction.
 * Handles special cases for date, numeric, boolean, and string columns.
 *
 * @param {Array<InventoryItem>} [data=inventory] - Array of inventory items to sort (defaults to main inventory)
 * @returns {Array<InventoryItem>} Sorted inventory data
 *
 * @example
 * sortInventory([{name: 'A'}, {name: 'B'}]);
 */
const sortInventory = (data = inventory) => {
  if (sortColumn === null) return data;

  // Pre-calculate sort values (Schwartzian transform) to avoid repeated computation
  // Map column index to data property — must match <th> order in index.html
  // 0:Date 1:Metal 2:Type 3:Image 4:Name 5:Qty 6:Weight 7:Purchase 8:Melt 9:Retail 10:Gain/Loss 11:Source 12:Actions
  const mapped = data.map((item) => {
    let val;
    let secondaryVal = 0; // secondary sort key; only populated for column 4 (Name)
    const spot = spotPrices[(item.metal || "").toLowerCase()] || 0;
    switch (sortColumn) {
      case 0: {
        // Date
        // Optimized: pre-parse date to timestamp (or Infinity for invalid/empty)
        const dateStr = String(item.date || "").trim();
        if (!item.date || dateStr === "" || dateStr === "—") {
          val = Infinity;
        } else {
          const d = new Date(dateStr);
          val = isNaN(d.getTime()) ? Infinity : d.getTime();
        }
        break;
      }
      case 1:
        val = item.composition || item.metal;
        break; // Metal
      case 2:
        val = item.type;
        break; // Type
      case 3:
        val = 0;
        break; // Image (non-sortable)
      case 4: // Name
        val = item.name;
        secondaryVal = parseInt(item.year, 10) || 0; // Pre-calc secondary sort key
        break;
      case 5:
        val = item.qty;
        break; // Qty
      case 6:
        val = parseFloat(item.weight) || 0;
        break; // Weight
      case 7:
        val = parseFloat(item.price) || 0;
        break; // Purchase Price
      case 8: // Melt Value (computed)
        val = computeMeltValue(item, spot);
        break;
      case 9: {
        // Retail Price (gbDenom → marketValue → melt, matching render logic)
        const qty = Number(item.qty) || 1;
        const gb =
          typeof getGoldbackRetailPrice === "function" ? getGoldbackRetailPrice(item) : null;
        val = gb
          ? gb * qty
          : item.marketValue && item.marketValue > 0
            ? item.marketValue * qty
            : computeMeltValue(item, spot);
        break;
      }
      case 10: {
        // Gain/Loss (computed, qty-adjusted, matching render logic)
        const qty = Number(item.qty) || 1;
        const gb =
          typeof getGoldbackRetailPrice === "function" ? getGoldbackRetailPrice(item) : null;
        const retail = gb
          ? gb * qty
          : item.marketValue && item.marketValue > 0
            ? item.marketValue * qty
            : computeMeltValue(item, spot);
        val = retail - (parseFloat(item.price) || 0) * qty;
        break;
      }
      case 11:
        val = item.purchaseLocation;
        break; // Source
      default:
        val = 0;
    }
    return { item, val, secondaryVal };
  });

  mapped.sort((aWrapper, bWrapper) => {
    const valA = aWrapper.val;
    const valB = bWrapper.val;

    // Special handling for date: empty/unknown dates sort as "infinitely old"
    if (sortColumn === 0) {
      // Simple numeric comparison for pre-calculated timestamps
      // Dateless items = oldest: top when asc, bottom when desc
      if (valA === Infinity && valB === Infinity) return 0;
      if (valA === Infinity) return sortDirection === "asc" ? -1 : 1;
      if (valB === Infinity) return sortDirection === "asc" ? 1 : -1;

      return sortDirection === "asc" ? valA - valB : valB - valA;
    }

    // Numeric comparison for numbers
    if (typeof valA === "number" && typeof valB === "number") {
      return sortDirection === "asc" ? valA - valB : valB - valA;
    }
    // String comparison for everything else
    else {
      const cmp =
        sortDirection === "asc"
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      // Secondary sort by year when names are equal
      if (cmp === 0 && sortColumn === 4) {
        // Use pre-calculated secondaryVal
        const yearA = aWrapper.secondaryVal;
        const yearB = bWrapper.secondaryVal;
        return sortDirection === "asc" ? yearA - yearB : yearB - yearA;
      }
      return cmp;
    }
  });

  return mapped.map((wrapper) => wrapper.item);
};

// =============================================================================

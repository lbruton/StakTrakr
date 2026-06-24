// SORTING FUNCTIONALITY
// =============================================================================

const SORT_COL_LAST_MODIFIED = 99;
const SORT_COL_MINTAGE = 100;
const SORT_COL_RARITY = 101;
const SORT_COL_STORAGE_LOCATION = 102;
const SORT_COL_YEAR = 103;

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
  // Map column index to data property — physical columns must match <th> order in index.html
  // 0:Date 1:Metal 2:Type 3:Image 4:Name 5:Qty 6:Weight 7:Purchase 8:Melt 9:Retail 10:Gain/Loss 11:Source 12:Actions
  // Virtual (no <th>): 99:Last Modified 100:Mintage 101:Rarity 102:Storage 103:Year
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
        // STRK-237: cu rows display derived silver oz (not the stored face value), so sort by
        // the same derived oz to keep the column's sort aligned with what is shown.
        val =
          item.weightUnit === "cu" && typeof getConstitutionalSilverOz === "function"
            ? getConstitutionalSilverOz(item)
            : parseFloat(item.weight) || 0;
        break; // Weight
      case 7:
        val = (parseFloat(item.price) || 0) * (Number(item.qty) || 0);
        break; // Purchase Total (price × qty)
      case 8: // Melt Value (computed)
        val = computeMeltValue(item, spot);
        break;
      case 9: {
        // Retail Price (max Goldback denomination/manual → melt, matching render logic)
        val =
          typeof calculateRetailPrice === "function"
            ? calculateRetailPrice(item, spot).retailTotal
            : item.marketValue && item.marketValue > 0
              ? item.marketValue * (Number(item.qty) || 1)
              : computeMeltValue(item, spot);
        break;
      }
      case 10: {
        // Gain/Loss (computed, qty-adjusted, matching render logic)
        const qty = Number(item.qty) || 1;
        const retail =
          typeof calculateRetailPrice === "function"
            ? calculateRetailPrice(item, spot).retailTotal
            : item.marketValue && item.marketValue > 0
              ? item.marketValue * qty
              : computeMeltValue(item, spot);
        val = retail - (parseFloat(item.price) || 0) * qty;
        break;
      }
      case 11:
        val = item.purchaseLocation;
        break; // Source
      case SORT_COL_STORAGE_LOCATION:
        val = item.storageLocation || "—";
        break; // Storage Location
      case SORT_COL_YEAR: {
        // Year — numeric, missing/unknown → end
        const yearStr = String(item.year || "").trim();
        if (yearStr === "" || yearStr === "—" || yearStr.toLowerCase() === "unknown") {
          val = Infinity;
        } else {
          const parsed = parseInt(yearStr, 10);
          val = Number.isNaN(parsed) ? Infinity : parsed;
        }
        break;
      }
      case SORT_COL_LAST_MODIFIED: {
        // Last Modified
        const lmStr = item.lastModified || "";
        val = lmStr ? new Date(lmStr).getTime() : 0;
        if (Number.isNaN(val)) val = 0;
        break;
      }
      case SORT_COL_MINTAGE: {
        // Mintage — manual or Numista-derived; tolerates "1,000,000" or numeric
        const raw = item.numistaData?.mintage;
        if (raw === undefined || raw === null || raw === "") {
          val = Infinity;
        } else {
          const parsed = parseFloat(String(raw).replace(/[, ]/g, ""));
          val = !isFinite(parsed) || parsed <= 0 ? Infinity : parsed;
        }
        break;
      }
      case SORT_COL_RARITY: {
        // Rarity Index (Numista 1-100; 0/missing → end)
        const r = parseFloat(String(item.numistaData?.rarityIndex ?? "").replace(/[, ]/g, ""));
        val = !Number.isFinite(r) || r <= 0 ? Infinity : r;
        break;
      }
      default:
        val = 0;
    }
    return { item, val, secondaryVal };
  });

  mapped.sort((aWrapper, bWrapper) => {
    const valA = aWrapper.val;
    const valB = bWrapper.val;

    // Special handling for date: empty/unknown dates sort as "infinitely old"
    if (sortColumn === 0 || sortColumn === SORT_COL_LAST_MODIFIED) {
      // Numeric timestamps: 0 (no date) treated as oldest
      if (valA === valB) return 0;
      const aIsEmpty = sortColumn === 0 ? valA === Infinity : valA === 0;
      const bIsEmpty = sortColumn === 0 ? valB === Infinity : valB === 0;
      if (aIsEmpty && bIsEmpty) return 0;
      if (aIsEmpty) return sortDirection === "asc" ? -1 : 1;
      if (bIsEmpty) return sortDirection === "asc" ? 1 : -1;

      return sortDirection === "asc" ? valA - valB : valB - valA;
    }

    // Mintage / Rarity / Year: missing values bucket to the end regardless of direction
    if (
      sortColumn === SORT_COL_MINTAGE ||
      sortColumn === SORT_COL_RARITY ||
      sortColumn === SORT_COL_YEAR
    ) {
      const aIsEmpty = valA === Infinity;
      const bIsEmpty = valB === Infinity;
      if (aIsEmpty && bIsEmpty) return 0;
      if (aIsEmpty) return 1;
      if (bIsEmpty) return -1;
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

window.SORT_COL_LAST_MODIFIED = SORT_COL_LAST_MODIFIED;
window.SORT_COL_MINTAGE = SORT_COL_MINTAGE;
window.SORT_COL_RARITY = SORT_COL_RARITY;
window.SORT_COL_STORAGE_LOCATION = SORT_COL_STORAGE_LOCATION;
window.SORT_COL_YEAR = SORT_COL_YEAR;

// =============================================================================

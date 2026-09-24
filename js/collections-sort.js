// STRK-392: pure Ledger sorting. Callers supply rows in definition/default order.
(() => {
  "use strict";
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

  /**
   * Sorts a copy by typed keys; unknowns stay last and ties retain input order.
   * Numeric strings are deliberately unknown: callers must supply raw numeric data.
   * @param {Object[]} rows - Rows in default order, never a previous sorted result
   * @param {Function} keyOf - Reads a nullable number or text key
   * @param {string} direction - asc or desc
   * @param {string} type - number (default) or text
   * @returns {Object[]} Sorted copy
   */
  const sortRows = (rows, keyOf, direction = "asc", type = "number") => {
    const decorated = rows.map((row, index) => {
      const value = keyOf(row);
      const known =
        type === "text"
          ? typeof value === "string" && value.trim().length > 0
          : Number.isFinite(value);
      return { row, index, value, known };
    });
    decorated.sort((a, b) => {
      if (a.known !== b.known) return a.known ? -1 : 1;
      if (!a.known) return a.index - b.index;
      const compared =
        type === "text" ? collator.compare(a.value, b.value) : Math.sign(a.value - b.value);
      return (direction === "desc" ? -compared : compared) || a.index - b.index;
    });
    return decorated.map(({ row }) => row);
  };

  /**
   * Reads a hub key without using rounded percentages or formatted currency.
   * @param {Object} entry - Hub view model
   * @param {string} key - Selected column
   * @returns {number|string|null} Typed key
   */
  const hubKey = (entry, key) => {
    switch (key) {
      case "name":
        return entry.name;
      case "progress":
        return entry.progress.total > 0 ? entry.progress.owned / entry.progress.total : null;
      case "owned":
        return entry.progress.owned;
      case "melt":
        return entry.ledgerMelt;
      case "cost":
        return entry.progress.missing === 0 ? 0 : entry.costToComplete;
      default:
        return null;
    }
  };

  /**
   * Starts a column ascending or reverses the active column.
   * @param {Object|null} current - Transient sort selection
   * @param {string} key - Selected column
   * @returns {Object} Next selection
   */
  const nextSort = (current, key) => ({
    key,
    direction: current?.key === key && current.direction === "asc" ? "desc" : "asc",
  });
  window.collectionsSort = Object.freeze({ sortRows, hubKey, nextSort });
})();

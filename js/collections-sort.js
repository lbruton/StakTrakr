// STRK-392: pure Ledger sorting. Callers supply rows in definition/default order.
(() => {
  "use strict";
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const sortChoices = Object.freeze([
    ["my-order", "My order"],
    ["name", "Name"],
    ["run-start", "Run start"],
    ["percent-complete", "Progress"],
    ["recently-updated", "Recently updated"],
    ["owned", "Owned"],
    ["value-melt", "Value (melt)"],
    ["to-complete", "To complete"],
  ]);
  const sortKeys = new Set(sortChoices.map(([key]) => key));
  const defaultDirections = Object.freeze({
    "my-order": "asc",
    name: "asc",
    "run-start": "asc",
    "percent-complete": "desc",
    "recently-updated": "desc",
    owned: "desc",
    "value-melt": "desc",
    "to-complete": "asc",
  });

  /**
   * Normalizes the device-local hub preference record.
   * @param {*} value - Persisted preference candidate
   * @returns {{order: string[], sortKey: string, direction: string}} Safe preferences
   */
  const normalizeHubPreferences = (value) => {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const order = [];
    const seen = new Set();
    (Array.isArray(source.order) ? source.order : []).forEach((id) => {
      if (typeof id !== "string" || !id.trim() || seen.has(id)) return;
      seen.add(id);
      order.push(id);
    });
    const sortKey = sortKeys.has(source.sortKey) ? source.sortKey : "my-order";
    const direction =
      source.direction === "asc" || source.direction === "desc"
        ? source.direction
        : defaultDirections[sortKey];
    return { order, sortKey, direction };
  };

  /**
   * Returns entries in saved My order, ignoring removed ids and appending new entries
   * in the caller's fallback order.
   * @param {Object[]} entries - Current entries in chronological fallback order
   * @param {string[]} order - Saved collection ids
   * @returns {Object[]} Ordered entries
   */
  const orderEntries = (entries, order) => {
    const byId = new Map();
    entries.forEach((entry) => {
      if (entry && typeof entry.id === "string" && !byId.has(entry.id)) byId.set(entry.id, entry);
    });
    const result = [];
    const used = new Set();
    (Array.isArray(order) ? order : []).forEach((id) => {
      if (!byId.has(id) || used.has(id)) return;
      used.add(id);
      result.push(byId.get(id));
    });
    entries.forEach((entry) => {
      if (!entry || typeof entry.id !== "string" || used.has(entry.id)) return;
      used.add(entry.id);
      result.push(entry);
    });
    return result;
  };

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
      case "percent-complete":
      case "progress":
        return entry.progress.total > 0 ? entry.progress.owned / entry.progress.total : null;
      case "owned":
        return entry.progress.owned;
      case "run-start":
        return Number.isFinite(entry.template?.run?.start) ? entry.template.run.start : null;
      case "recently-updated": {
        const updated = entry.collection?.lastModified || entry.lastModified;
        return typeof updated === "string" && updated.trim() ? updated : null;
      }
      case "value-melt":
      case "melt":
        return entry.ledgerMelt;
      case "to-complete":
      case "cost":
        return entry.progress.missing === 0 ? 0 : entry.costToComplete;
      default:
        return null;
    }
  };

  /**
   * Applies a preset after first arranging rows in My order, making sort ties predictable.
   * @param {Object[]} entries - Current entries
   * @param {Object} preferences - Hub sort and order preference
   * @returns {Object[]} Entries in the selected order
   */
  const sortHubEntries = (entries, preferences) => {
    const selected = normalizeHubPreferences(preferences);
    const ordered = orderEntries(entries, selected.order);
    if (selected.sortKey === "my-order") return ordered;
    const textSort = selected.sortKey === "name" || selected.sortKey === "recently-updated";
    return sortRows(
      ordered,
      (entry) => hubKey(entry, selected.sortKey),
      selected.direction,
      textSort ? "text" : "number"
    );
  };

  /**
   * Moves one visible id to a target's position while leaving hidden ids in their slots.
   * `after` is used by both the down button and a drop in the lower half of a row/card.
   * @param {string[]} order - Full order, including hidden ids
   * @param {string[]} visibleIds - Ids currently shown in the arrangement
   * @param {string} id - Id being moved
   * @param {string} targetId - Visible target id
   * @param {boolean} [after] - Insert immediately after the target
   * @returns {string[]} Updated full order
   */
  const moveVisibleId = (order, visibleIds, id, targetId, after = false) => {
    const visible = new Set(visibleIds);
    const moving = order.filter((candidate) => visible.has(candidate));
    const from = moving.indexOf(id);
    const target = moving.indexOf(targetId);
    if (from < 0 || target < 0 || id === targetId) return order.slice();
    moving.splice(from, 1);
    const targetAfterRemoval = moving.indexOf(targetId);
    moving.splice(targetAfterRemoval + (after ? 1 : 0), 0, id);
    let nextVisible = 0;
    return order.map((candidate) => {
      if (!visible.has(candidate)) return candidate;
      return moving[nextVisible++];
    });
  };

  /**
   * Writes a candidate preference and only accepts it when the writer succeeds.
   * @param {Object} current - Previously committed preferences
   * @param {Object} next - Candidate preference value
   * @param {(value: Object) => void} write - Persistence function
   * @returns {{ok: boolean, preferences: Object, error: Error|null}} Commit result
   */
  const commitHubPreferences = (current, next, write) => {
    const preferences = normalizeHubPreferences(next);
    try {
      write(preferences);
      return { ok: true, preferences, error: null };
    } catch (error) {
      return { ok: false, preferences: current, error };
    }
  };

  /**
   * Default direction for a newly selected preset.
   * @param {string} key - Sort key
   * @returns {"asc"|"desc"} Preset direction
   */
  const defaultDirection = (key) => defaultDirections[key] || "asc";

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
  window.collectionsSort = Object.freeze({
    sortChoices,
    normalizeHubPreferences,
    orderEntries,
    sortRows,
    sortHubEntries,
    hubKey,
    nextSort,
    moveVisibleId,
    commitHubPreferences,
    defaultDirection,
  });
})();

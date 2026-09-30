// STRK-393 — enabled / disabled Collection preferences inside Settings.
(() => {
  "use strict";

  const ROOT_ID = "collectionsSettingsRoot";
  const SUMMARY_ID = "collectionsSettingsSummary";
  const CHANGED_EVENT = "collections:changed";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SAVE_ERROR = "Couldn't save the Collection setting. Try again.";
  const STATUS_ID = "collectionsSettingsOrderStatus";
  const ROW_SELECTOR = ".collections-settings-row[data-collection-id]";
  const MOVE_UP = "move-up";
  const MOVE_DOWN = "move-down";
  let builderCloseObserver = null;
  // Last My order save result, re-shown after every render (STRK-378).
  let orderStatus = { text: "", isError: false };

  const ICON_SHAPES = Object.freeze({
    lock: [
      { tag: "rect", attributes: { x: "4", y: "11", width: "16", height: "10", rx: "2" } },
      { tag: "path", attributes: { d: "M8 11V7a4 4 0 0 1 8 0v4" } },
    ],
    edit: [
      { tag: "path", attributes: { d: "M12 20h9" } },
      { tag: "path", attributes: { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" } },
    ],
    copy: [
      { tag: "rect", attributes: { x: "9", y: "9", width: "12", height: "12", rx: "2" } },
      { tag: "path", attributes: { d: "M5 15V5a2 2 0 0 1 2-2h10" } },
    ],
    grip: [
      [8, 5],
      [16, 5],
      [8, 12],
      [16, 12],
      [8, 19],
      [16, 19],
    ].map(([cx, cy]) => ({
      tag: "circle",
      attributes: { cx: String(cx), cy: String(cy), r: "1" },
    })),
    up: [{ tag: "path", attributes: { d: "m6 15 6-6 6 6" } }],
    down: [{ tag: "path", attributes: { d: "m6 9 6 6 6-6" } }],
  });

  /**
   * Creates a static decorative icon without parsing HTML.
   * @param {"lock"|"edit"|"copy"|"grip"|"up"|"down"} name - Icon path key
   * @returns {HTMLSpanElement} Decorative icon wrapper
   */
  const createIcon = (name) => {
    const wrap = document.createElement("span");
    wrap.className = "collections-settings-icon";
    wrap.setAttribute("aria-hidden", "true");

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", name === "lock" ? "2.2" : "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    ICON_SHAPES[name].forEach(({ tag, attributes }) => {
      const shape = document.createElementNS(SVG_NS, tag);
      Object.entries(attributes).forEach(([attribute, value]) =>
        shape.setAttribute(attribute, value)
      );
      svg.appendChild(shape);
    });
    wrap.appendChild(svg);
    return wrap;
  };

  /**
   * Counts unique linked Item IDs which are stored in Spare positions.
   * @param {Object} collection - Collection record from the view model
   * @param {Set<string>} linkedIds - Unique linked Item IDs from the store
   * @returns {number} Unique linked Spare IDs
   */
  const countSpareIds = (collection, linkedIds) => {
    const spareIds = new Set();
    const slots = collection && collection.slots;
    if (!slots || typeof slots !== "object") return 0;

    Object.values(slots).forEach((slot) => {
      if (!slot || !Array.isArray(slot.spares)) return;
      slot.spares.forEach((uuid) => {
        if (typeof uuid === "string" && uuid.trim() && linkedIds.has(uuid)) spareIds.add(uuid);
      });
    });
    return spareIds.size;
  };

  /**
   * Tests whether an empty Custom Collection still has any saved Slot artwork.
   * @param {Object} collection - Collection record from the view model
   * @returns {boolean} Whether a Slot artwork stamp is present
   */
  const hasSlotArtwork = (collection) => {
    const artwork = collection && collection.artwork;
    if (!artwork || typeof artwork !== "object") return false;
    return Object.keys(artwork).some(
      (key) => key.startsWith("slot:") && artwork[key]?.present === true
    );
  };

  /**
   * Derives settings-only state without changing the shared Collections entry view model.
   * @returns {Object[]} Render rows derived from the existing entry builder
   */
  const buildRows = () => {
    const store = window.collectionsStore;
    // One list in My order; ids missing from the saved order follow in chronological order.
    const entries = window.collectionsSort.orderEntries(
      window.collectionsUI.buildEntries(),
      window.collectionsUI.getHubPreferences().order
    );
    return entries.map((entry) => {
      const savedCollection = store.getState().collections[entry.id];
      const linkedItemIds = store.linkedItemIds(entry.id);
      const linkedSet = new Set(linkedItemIds);
      const spares = countSpareIds(entry.collection, linkedSet);
      const unresolved = linkedItemIds.filter((uuid) => !store.findItem(uuid)).length;
      const hasLiveTemplateRecord = Boolean(
        savedCollection && savedCollection.kind === "template" && !savedCollection.deletedAt
      );
      const isNotStarted = !entry.isCustom && !hasLiveTemplateRecord;
      const meta = entry.isCustom
        ? `${entry.slotDefs.length} Slot${entry.slotDefs.length === 1 ? "" : "s"}`
        : entry.hubLine;

      return {
        id: entry.id,
        name: entry.name,
        variant: entry.variant,
        meta: isNotStarted ? `${meta} · not started` : meta,
        owned: entry.progress.owned,
        total: entry.progress.total,
        isCustom: entry.isCustom,
        linkedItemIds,
        enabled: store.isEnabled(entry.id),
        editable: entry.isCustom,
        spares,
        unresolved,
        hasSlotArtwork: hasSlotArtwork(entry.collection),
      };
    });
  };

  /**
   * Accessible display label for a Collection row, including a template variant.
   * @param {Object} row - Settings row model
   * @returns {string} Name used for the toggle and action
   */
  const rowLabel = (row) => [row.name, row.variant].filter(Boolean).join(" ");

  /**
   * Creates the desktop column header.
   * @returns {HTMLDivElement} Header row
   */
  const buildHeader = () => {
    const header = document.createElement("div");
    header.className = "collections-settings-header";
    header.setAttribute("aria-hidden", "true");
    ["", "Collection", "Owned / total", "Show in hub", "Order · Action"].forEach((label) => {
      const cell = document.createElement("span");
      cell.textContent = label;
      header.appendChild(cell);
    });
    return header;
  };

  /**
   * Builds the text and icon for the visible linked-Item restriction.
   * @param {Object} row - Settings row model
   * @returns {HTMLSpanElement} Accessible reason text
   */
  const buildLockedReason = (row) => {
    const reason = document.createElement("span");
    reason.className = "collections-settings-reason";
    reason.id = `collections-settings-reason-${encodeURIComponent(row.id)}`;
    reason.appendChild(createIcon("lock"));

    const details = [];
    if (row.spares > 0) details.push(`${row.spares} Spare${row.spares === 1 ? "" : "s"}`);
    if (row.unresolved > 0) details.push(`${row.unresolved} no longer in inventory`);
    const breakdown = details.length ? ` (incl. ${details.join(", ")})` : "";
    reason.appendChild(
      document.createTextNode(
        `${row.linkedItemIds.length} linked Items${breakdown} · unlink them to turn off`
      )
    );
    return reason;
  };

  /**
   * Builds the Collection name, meta line, hidden tag, and any row-specific note.
   * @param {Object} row - Settings row model
   * @returns {HTMLDivElement} Name cell
   */
  const buildNameCell = (row) => {
    const nameCell = document.createElement("div");
    nameCell.className = "collections-settings-name";

    const title = document.createElement("b");
    title.appendChild(document.createTextNode(row.name));
    const typeBadge = document.createElement("span");
    typeBadge.className = `collections-settings-type ${row.isCustom ? "is-custom" : "is-template"}`;
    typeBadge.textContent = row.isCustom ? "Custom" : "Template";
    title.appendChild(typeBadge);
    if (!row.enabled) {
      const hiddenTag = document.createElement("span");
      hiddenTag.className = "collections-settings-tag is-hidden";
      hiddenTag.textContent = "Hidden from hub";
      title.appendChild(hiddenTag);
    }
    nameCell.appendChild(title);

    const meta = document.createElement("span");
    meta.className = "collections-settings-meta";
    meta.textContent = row.meta;
    nameCell.appendChild(meta);

    if (row.linkedItemIds.length > 0) {
      nameCell.appendChild(buildLockedReason(row));
    } else if (!row.enabled && row.hasSlotArtwork) {
      const artworkNote = document.createElement("span");
      artworkNote.className = "collections-settings-artwork-note";
      artworkNote.textContent = "Slot artwork is kept and returns when turned back on.";
      nameCell.appendChild(artworkNote);
    }
    return nameCell;
  };

  /**
   * Builds the owned / total progress cell.
   * @param {Object} row - Settings row model
   * @returns {HTMLDivElement} Progress cell
   */
  const buildProgressCell = (row) => {
    const progress = document.createElement("div");
    progress.className = "collections-settings-progress";

    const count = document.createElement("span");
    count.textContent = `${row.owned} / ${row.total}`;
    progress.appendChild(count);

    const track = document.createElement("div");
    track.className = "collections-settings-progress-track";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.className = "collections-settings-progress-fill";
    fill.style.width = `${row.total > 0 ? Math.max(0, Math.min(100, (row.owned / row.total) * 100)) : 0}%`;
    track.appendChild(fill);
    progress.appendChild(track);
    return progress;
  };

  /**
   * Builds the accessible On/Off segmented toggle.
   * @param {Object} row - Settings row model
   * @returns {HTMLDivElement} Toggle group
   */
  const buildToggle = (row) => {
    const toggle = document.createElement("div");
    toggle.className = "chip-sort-toggle collections-settings-toggle";
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", `Show ${rowLabel(row)} in Collections`);
    if (row.linkedItemIds.length > 0) {
      toggle.setAttribute(
        "aria-describedby",
        `collections-settings-reason-${encodeURIComponent(row.id)}`
      );
      toggle.classList.add("is-locked");
    }

    [true, false].forEach((enabled) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip-sort-btn";
      button.textContent = enabled ? "On" : "Off";
      button.dataset.collectionsAction = "toggle";
      button.dataset.collectionId = row.id;
      button.dataset.enabled = String(enabled);
      button.setAttribute("aria-pressed", String(row.enabled === enabled));
      button.classList.toggle("active", row.enabled === enabled);
      button.disabled = row.linkedItemIds.length > 0;
      toggle.appendChild(button);
    });
    return toggle;
  };

  /**
   * Builds the Move up / Move down buttons plus the Edit or Clone & customize action.
   * @param {Object} row - Settings row model
   * @param {number} index - Row position in My order
   * @param {number} count - Number of rows
   * @returns {HTMLDivElement} Action cell
   */
  const buildActionCell = (row, index, count) => {
    const cell = document.createElement("div");
    cell.className = "collections-settings-actions";

    const movers = document.createElement("span");
    movers.className = "collections-settings-movers";
    [
      [MOVE_UP, "up", index === 0],
      [MOVE_DOWN, "down", index === count - 1],
    ].forEach(([action, word, disabled]) => {
      const move = document.createElement("button");
      move.type = "button";
      move.className = "collections-settings-move";
      move.dataset.collectionsAction = action;
      move.dataset.collectionId = row.id;
      move.setAttribute("aria-label", `Move ${rowLabel(row)} ${word}`);
      move.title = `Move ${word}`;
      move.disabled = disabled;
      move.appendChild(createIcon(word));
      movers.appendChild(move);
    });
    cell.appendChild(movers);

    const action = document.createElement("button");
    action.type = "button";
    action.className = "btn secondary collections-btn-pill collections-settings-action";
    action.dataset.collectionsAction = row.editable ? "edit" : "clone";
    action.dataset.collectionId = row.id;
    action.setAttribute(
      "aria-label",
      row.editable ? `Edit ${row.name}` : `Clone and customize ${rowLabel(row)}`
    );
    action.appendChild(createIcon(row.editable ? "edit" : "copy"));
    action.appendChild(document.createTextNode(row.editable ? "Edit" : "Clone & customize"));
    cell.appendChild(action);
    return cell;
  };

  /**
   * Builds one Collection row, led by its drag handle.
   * @param {Object} row - Settings row model
   * @param {number} index - Row position in My order
   * @param {number} count - Number of rows
   * @returns {HTMLDivElement} Collection row
   */
  const buildRow = (row, index, count) => {
    const wrapper = document.createElement("div");
    wrapper.className = "collections-settings-row";
    wrapper.dataset.collectionId = row.id;
    if (!row.enabled) wrapper.classList.add("is-off");

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "collections-settings-handle";
    handle.dataset.collectionId = row.id;
    handle.setAttribute("aria-label", `Drag ${rowLabel(row)} to reorder`);
    handle.title = "Drag to reorder";
    // Pointer-only affordance: keyboard users reorder with the move buttons (PR 1517 review).
    handle.tabIndex = -1;
    handle.appendChild(createIcon("grip"));
    wrapper.appendChild(handle);
    wrapper.appendChild(buildNameCell(row));
    wrapper.appendChild(buildProgressCell(row));
    const toggleCell = document.createElement("div");
    toggleCell.className = "collections-settings-toggle-cell";
    toggleCell.appendChild(buildToggle(row));
    wrapper.appendChild(toggleCell);
    wrapper.appendChild(buildActionCell(row, index, count));
    return wrapper;
  };

  /**
   * Builds the titled My order group holding every Collection row.
   * @param {string} title - Group title
   * @param {string} hint - Group description
   * @param {Object[]} rows - Rows in My order
   * @param {string} headingId - Stable heading ID
   * @returns {HTMLDivElement} Fieldset group
   */
  const buildGroup = (title, hint, rows, headingId) => {
    const group = document.createElement("section");
    group.className = "settings-fieldset collections-settings-fieldset";
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", headingId);

    const titleRow = document.createElement("div");
    titleRow.className = "settings-fieldset-title collections-settings-title";
    const heading = document.createElement("span");
    heading.id = headingId;
    heading.textContent = title;
    const count = document.createElement("span");
    count.className = "collections-settings-count";
    count.textContent = String(rows.length);
    titleRow.append(heading, count);
    group.appendChild(titleRow);

    const groupHint = document.createElement("p");
    groupHint.className = "settings-subtext collections-settings-hint";
    groupHint.textContent = hint;
    group.appendChild(groupHint);
    group.appendChild(buildHeader());
    rows.forEach((row, index) => group.appendChild(buildRow(row, index, rows.length)));
    return group;
  };

  /**
   * Captures the active action so a preference-triggered render can restore focus.
   * @param {HTMLElement} root - Settings render root
   * @returns {{action: string, id: string, enabled: string}|null} Focus descriptor
   */
  const captureFocus = (root) => {
    const active = document.activeElement;
    if (!root.contains(active) || !active.dataset.collectionsAction) return null;
    return {
      action: active.dataset.collectionsAction,
      id: active.dataset.collectionId || "",
      enabled: active.dataset.enabled || "",
    };
  };

  /**
   * Restores focus to a matching action after rebuilding the panel.
   * @param {HTMLElement} root - Settings render root
   * @param {{action: string, id: string, enabled: string}|null} descriptor - Focus key
   * @returns {void}
   */
  const restoreFocus = (root, descriptor) => {
    if (!descriptor) return;
    const buttons = root.querySelectorAll("button[data-collections-action]");
    const match = Array.from(buttons).find(
      (button) =>
        button.dataset.collectionsAction === descriptor.action &&
        button.dataset.collectionId === descriptor.id &&
        (button.dataset.enabled || "") === descriptor.enabled
    );
    if (!match) return;
    // A move that reached the list edge disables its own button; hand focus to the other one.
    if (match.disabled && (descriptor.action === MOVE_UP || descriptor.action === MOVE_DOWN)) {
      const opposite = descriptor.action === MOVE_UP ? MOVE_DOWN : MOVE_UP;
      restoreFocus(root, { ...descriptor, action: opposite });
      return;
    }
    match.focus({ preventScroll: true });
  };

  /**
   * Shows the last My order save result in a live region beside the list. The region is
   * created once, outside the re-rendered root, so screen readers announce each change.
   * @param {HTMLElement} root - Settings render root
   * @returns {void}
   */
  const renderOrderStatus = (root) => {
    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement("p");
      status.id = STATUS_ID;
      status.className = "collections-settings-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      root.insertAdjacentElement("afterend", status);
    }
    status.textContent = orderStatus.text;
    status.classList.toggle("is-error", orderStatus.isError);
  };

  /**
   * Moves one Collection to a target's position in My order and saves it at once.
   * @param {string} id - Collection being moved
   * @param {string} targetId - Collection it moves next to
   * @param {boolean} after - Place it after the target instead of before
   * @returns {void}
   */
  const applyMove = (id, targetId, after) => {
    const rows = buildRows();
    const ids = rows.map((row) => row.id);
    const next = window.collectionsSort.moveVisibleId(ids, ids, id, targetId, after);
    if (next.every((candidate, index) => candidate === ids[index])) return;
    if (window.collectionsUI.saveHubOrder(next)) {
      const row = rows.find((candidate) => candidate.id === id);
      const position = next.indexOf(id) + 1;
      orderStatus = {
        text: `Saved · ${rowLabel(row)} moved to position ${position} of ${next.length}.`,
        isError: false,
      };
    } else {
      orderStatus = { text: "Couldn't save the new order. Nothing changed.", isError: true };
    }
    render();
  };

  /**
   * Handles a Move up / Move down click by moving past the neighbouring row.
   * @param {string} action - MOVE_UP or MOVE_DOWN
   * @param {string} id - Collection being moved
   * @returns {void}
   */
  const handleMove = (action, id) => {
    const ids = buildRows().map((row) => row.id);
    const neighbour = ids[ids.indexOf(id) + (action === MOVE_UP ? -1 : 1)];
    if (neighbour) applyMove(id, neighbour, action === MOVE_DOWN);
  };

  /**
   * Wires each row's drag handle to the shared pointer reorder used by the Ledger.
   * @param {HTMLElement} root - Settings render root
   * @returns {void}
   */
  const wireDragHandles = (root) => {
    if (typeof window.collectionsUI.wireReorderHandle !== "function") return;
    root.querySelectorAll(".collections-settings-handle").forEach((handle) => {
      window.collectionsUI.wireReorderHandle(handle, {
        id: handle.dataset.collectionId,
        itemSelector: ROW_SELECTOR,
        idOf: (node) => node.dataset.collectionId,
        onDrop: (targetId, after) => applyMove(handle.dataset.collectionId, targetId, after),
      });
    });
  };

  /**
   * Returns keyboard focus to the refreshed Edit action after the builder closes.
   * @param {string} collectionId - Custom Collection being edited
   * @returns {void}
   */
  const restoreEditFocusWhenBuilderCloses = (collectionId) => {
    const builder = document.getElementById("collectionsBuilderModal");
    if (!builder) return;
    if (builderCloseObserver) builderCloseObserver.disconnect();

    const observer = new MutationObserver(() => {
      if (builder.style.display !== "none") return;
      observer.disconnect();
      if (builderCloseObserver === observer) builderCloseObserver = null;

      const root = document.getElementById(ROOT_ID);
      const settingsModal = document.getElementById("settingsModal");
      if (!root || !settingsModal || settingsModal.style.display === "none") return;
      // closeModalById clears the body lock when the builder closes, even though
      // Settings remains open underneath it.
      document.body.style.overflow = "hidden";
      const refreshedEdit = Array.from(
        root.querySelectorAll('button[data-collections-action="edit"]')
      ).find((button) => button.dataset.collectionId === collectionId);
      if (refreshedEdit) refreshedEdit.focus({ preventScroll: true });
    });
    builderCloseObserver = observer;
    observer.observe(builder, { attributes: true, attributeFilter: ["style"] });
  };

  /**
   * Renders the current templates and live Custom Collections into the Settings panel.
   * @returns {void}
   */
  const render = () => {
    const root = document.getElementById(ROOT_ID);
    const summary = document.getElementById(SUMMARY_ID);
    if (!root || !summary || !window.collectionsStore || !window.collectionsUI?.buildEntries)
      return;

    const focus = captureFocus(root);
    const rows = buildRows();
    const shown = rows.filter((row) => row.enabled).length;
    summary.textContent =
      "Choose which Collections appear in the Collections hub. Turning one off only hides it; " +
      `its Slots, artwork and Items stay as they are. A Collection with linked Items stays on. ${shown} of ${rows.length} shown.`;

    // STRK-378: one list in My order — the order the hub uses when it is not sorted.
    const fragment = document.createDocumentFragment();
    fragment.appendChild(
      buildGroup(
        "My order",
        "Built-in templates and your Custom Collections, in one list. Drag a row or use " +
          "the arrows to set the order the hub shows. To delete a Custom Collection, use " +
          "Remove collection in its album.",
        rows,
        "collectionsSettingsOrderTitle"
      )
    );

    const footnote = document.createElement("p");
    footnote.className = "collections-settings-footnote";
    footnote.textContent =
      "Show in hub choices sync with Cloud and are saved in ZIP backups. A Collection that gets " +
      "Items from another device or a restore turns back on automatically. My order is saved " +
      "on this device.";
    fragment.appendChild(footnote);

    root.replaceChildren(fragment);
    wireDragHandles(root);
    renderOrderStatus(root);
    restoreFocus(root, focus);
  };

  /**
   * Handles all action buttons through one delegated listener.
   * @param {MouseEvent} event - Click event
   * @returns {void}
   */
  const handleClick = (event) => {
    const root = document.getElementById(ROOT_ID);
    const button = event.target.closest("button[data-collections-action]");
    if (!root || !button || !root.contains(button)) return;

    const action = button.dataset.collectionsAction;
    const collectionId = button.dataset.collectionId;
    if (action === "toggle") {
      const enabled = button.dataset.enabled === "true";
      let result;
      try {
        result = window.collectionsStore.setEnabled(collectionId, enabled);
      } catch (error) {
        console.error("[collections-settings] Failed to save Collection preference:", error);
        render();
        if (typeof window.showToast === "function") window.showToast(SAVE_ERROR);
        return;
      }
      if (!result.ok) {
        render();
        if (result.reason === "save-failed" && typeof window.showToast === "function") {
          window.showToast(SAVE_ERROR);
        }
      }
      return;
    }
    if (action === MOVE_UP || action === MOVE_DOWN) {
      handleMove(action, collectionId);
      return;
    }

    const picker = window.collectionsPicker;
    if (!picker || typeof picker.openBuilder !== "function") return;
    if (action === "edit") {
      picker.openBuilder({ editId: collectionId });
      restoreEditFocusWhenBuilderCloses(collectionId);
    } else if (action === "clone") {
      window.hideSettingsModal();
      picker.openBuilder({ cloneFrom: collectionId });
    }
  };

  const root = document.getElementById(ROOT_ID);
  if (root) root.addEventListener("click", handleClick);
  document.addEventListener(CHANGED_EVENT, render);

  window.collectionsSettings = Object.freeze({ render });
})();

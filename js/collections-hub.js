// Collections hub renderer. Loaded before collections-ui.js; the UI passes its shared
// DOM helpers and transient view state when it initializes this renderer.
(() => {
  "use strict";
  window.createCollectionsHubRenderer = (deps) => {
    const {
      el,
      button,
      icon,
      money,
      buildStats,
      buildViewToggle,
      buildPillButton,
      callPicker,
      render,
      core,
      store,
      buildTag,
      buildCoin,
      buildCount,
      buildProgress,
      buildEmptyState,
      getViewMode,
      openCollection,
      costLabel,
      STATUS_ALL,
      STATUS_PROGRESS,
      STATUS_NOT_STARTED,
      STATUS_COMPLETE,
      VIEW_LEDGER,
      DASH,
      PERCENT,
      state,
      getHubPreferences,
      saveHubSort,
      getHubArrangement,
      beginHubArrangement,
      cancelHubArrangement,
      saveHubArrangement,
      updateHubArrangement,
      wireReorderHandle,
    } = deps;
    const sort = window.collectionsSort;
    const MY_ORDER = "my-order";
    const openCollectionsSettings = () => {
      if (typeof window.showSettingsModal === "function") window.showSettingsModal("collections");
    };
    const sortColumns = [
      ["name", "Collection"],
      ["percent-complete", "Progress"],
      ["owned", "Owned"],
      ["value", "Value"],
      ["to-complete", "To complete"],
    ];

    /**
     * Selects a preset and keeps the committed My order list intact.
     * @param {string} key - Preset key
     * @param {string} [direction] - Optional explicit direction
     * @returns {void}
     */
    const selectSort = (key, direction) => {
      const nextDirection = direction || sort.defaultDirection(key);
      saveHubSort(key, nextDirection);
      // Re-render on failure too, restoring the selector to the last committed choice.
      render();
    };

    /**
     * User-facing name of a sort. Ledger column labels win so the Album hint, the header
     * and the phone select all say the same thing (STRK-378).
     * @param {string} key - Sort key
     * @returns {string} Label
     */
    const sortLabel = (key) =>
      (sortColumns.find(([candidate]) => candidate === key) ||
        sort.sortChoices.find(([candidate]) => candidate === key) || [key, key])[1];

    /**
     * Readable direction word.
     * @param {string} direction - asc or desc
     * @returns {string} ascending or descending
     */
    const directionWord = (direction) => (direction === "asc" ? "ascending" : "descending");

    /**
     * Phone-only sort select. The Ledger header row is hidden at phone width, so this
     * offers My order plus every column in both directions.
     * @returns {HTMLElement} Labelled select
     */
    const buildCompactSort = () => {
      const { sortKey, direction } = getHubPreferences();
      const label = el("label", "collections-hub-sort", "Sort ");
      const select = el("select");
      select.setAttribute("aria-label", "Sort collections");
      select.dataset.focusKey = "hubsort:compact";
      const addOption = (value, text) => {
        const option = el("option", "", text);
        option.value = value;
        select.appendChild(option);
      };
      addOption(MY_ORDER, "My order");
      sortColumns.forEach(([key, name]) => {
        ["asc", "desc"].forEach((dir) =>
          addOption(`${key}:${dir}`, `${name} — ${directionWord(dir)}`)
        );
      });
      const current = sortKey === MY_ORDER ? MY_ORDER : `${sortKey}:${direction}`;
      // A saved preset without a column (Run start, Recently updated) still shows truthfully.
      if (!Array.from(select.options).some((option) => option.value === current))
        addOption(current, `${sortLabel(sortKey)} — ${directionWord(direction)}`);
      select.value = current;
      select.disabled = Boolean(getHubArrangement());
      select.addEventListener("change", () => {
        const [key, dir] = select.value.split(":");
        selectSort(key, key === MY_ORDER ? "asc" : dir);
      });
      label.appendChild(select);
      return label;
    };

    /**
     * Ledger arrange control: an icon that starts arranging, or Cancel / Done while a draft
     * is open. Rendered in the header row and again beside the phone sort select.
     * @param {Object[]} entries - All Collections, including hidden ones
     * @returns {HTMLElement} The control cell
     */
    const buildArrangeCell = (entries) => {
      const cell = el("span", "collections-arrange-cell");
      if (getHubArrangement()) {
        cell.appendChild(
          buildPillButton({
            label: "Cancel",
            secondary: true,
            focusKey: "hub:arrange:cancel",
            onClick: cancelHubArrangement,
          })
        );
        cell.appendChild(
          buildPillButton({
            label: "Done",
            focusKey: "hub:arrange:done",
            onClick: saveHubArrangement,
          })
        );
        return cell;
      }
      if (state.hubFilter !== STATUS_ALL) return cell;
      const control = button("collections-arrange-toggle", "hub:arrange", () =>
        beginHubArrangement(entries)
      );
      control.setAttribute("aria-label", "Arrange Collections");
      control.title = "Arrange Collections";
      control.appendChild(icon("arrange"));
      cell.appendChild(control);
      return cell;
    };

    /** Builds the hub's sortable header while leaving the shared Slot header static.
     * @param {Object[]} entries - All Collections, for the arrange control
     * @returns {HTMLElement} Header row, wrapped with Cancel / Done while arranging
     */
    const buildHubHead = (entries) => {
      const preferences = getHubPreferences();
      const arranging = Boolean(getHubArrangement());
      const head = el("div", "collections-lrow is-head collections-hubrow");
      head.appendChild(el("span"));
      sortColumns.forEach(([key, label], index) => {
        const active = preferences.sortKey === key;
        const status = active ? directionWord(preferences.direction) : "not sorted";
        let nextDirection = sort.defaultDirection(key);
        if (active) nextDirection = preferences.direction === "asc" ? "desc" : "asc";
        const control = button(
          `collections-sort-header ${index > 1 ? "collections-num" : ""}`,
          `hubsort:${key}`,
          () => selectSort(key, nextDirection)
        );
        control.appendChild(el("span", "", label));
        let arrow = "↕";
        if (active) arrow = preferences.direction === "asc" ? "↑" : "↓";
        const indicator = el("span", "collections-sort-indicator", arrow);
        indicator.setAttribute("aria-hidden", "true");
        control.appendChild(indicator);
        control.setAttribute("aria-label", `Sort by ${label}, ${status}`);
        control.disabled = arranging;
        control.classList.toggle("is-active", active);
        head.appendChild(control);
      });
      if (!arranging) {
        head.appendChild(buildArrangeCell(entries));
        return head;
      }
      // Arranging rows carry their move controls beside the row grid; the header mirrors that
      // shape so its columns stay aligned and Cancel / Done sit above the move controls.
      head.classList.add("is-arranging");
      const wrapper = el("div", "collections-arrange-ledger-item collections-arrange-head");
      wrapper.appendChild(head);
      wrapper.appendChild(buildArrangeCell(entries));
      return wrapper;
    };

    /**
     * One-line note above the Album when it is not in My order, with a way back.
     * @returns {HTMLElement|null} The hint, or null in My order
     */
    const buildSortHint = () => {
      const { sortKey, direction } = getHubPreferences();
      if (sortKey === MY_ORDER || getHubArrangement()) return null;
      const hint = el("p", "collections-sort-hint", "Sorted by ");
      hint.appendChild(el("b", "", sortLabel(sortKey)));
      hint.appendChild(document.createTextNode(`, ${directionWord(direction)} `));
      const separator = el("span", "collections-sort-hint-sep", "·");
      separator.setAttribute("aria-hidden", "true");
      hint.appendChild(separator);
      hint.appendChild(document.createTextNode(" "));
      const reset = button("collections-sort-reset", "hub:show-my-order", () =>
        selectSort(MY_ORDER, "asc")
      );
      reset.textContent = "Show My order";
      hint.appendChild(reset);
      return hint;
    };

    // ---------------------------------------------------------------------------
    // Hub
    // ---------------------------------------------------------------------------

    /**
     * Hub header: title, BETA chip and the one-line explanation.
     * @returns {HTMLElement} Header block
     */
    const buildHubHeader = () => {
      const head = el("div", "collections-head");
      const titles = el("div");
      const heading = el("h2", "", "Collections");
      heading.appendChild(el("span", "collections-beta", "BETA"));
      titles.appendChild(heading);
      titles.appendChild(
        el(
          "p",
          "collections-sub",
          "Date runs and custom checklists, linked to the Items in your inventory."
        )
      );
      head.appendChild(titles);
      return head;
    };

    /**
     * Hub stat strip. "Active" means at least one slot is filled; value and cost are
     * summed over active collections only, so an untouched template adds no noise.
     * @param {Object[]} entries - Entry view models
     * @returns {HTMLElement} The strip
     */
    const buildHubStats = (entries) => {
      const active = entries.filter((entry) => entry.progress.owned > 0);
      /**
       * Sums one figure across the active collections.
       * @param {(entry: Object) => number} pick - Figure to read from each entry
       * @returns {number} Total
       */
      const sum = (pick) => active.reduce((total, entry) => total + pick(entry), 0);
      const filled = sum((entry) => entry.progress.owned);
      const total = sum((entry) => entry.progress.total);
      const paid = sum((entry) => entry.paid);
      const melt = sum((entry) => entry.melt);
      const retail = sum((entry) => entry.retail);
      const unpriced = active.filter((entry) => !entry.retailAvailable).length;
      const cost = sum((entry) => entry.costToComplete || 0);
      const idle = entries.length - active.length;
      return buildStats([
        {
          label: "Collections",
          value: String(active.length),
          unit: "active",
          note: `${idle} not started`,
        },
        {
          label: "Slots filled",
          value: String(filled),
          unit: `/ ${total}`,
          note: `${total ? Math.round((filled / total) * PERCENT) : 0}% across active collections`,
        },
        {
          label: "Collected value",
          value: retail ? money(retail) : DASH,
          note: `melt ${melt ? money(melt) : DASH} · paid ${money(paid)}${unpriced ? ` · ${unpriced} unpriced` : ""}`,
        },
        {
          label: "Cost to complete",
          value: costLabel(cost),
          note: "floor est. · best vendor price today",
          accent: true,
        },
      ]);
    };

    /**
     * Hub toolbar: status filter, view toggle, Manage and New collection. The Ledger adds a
     * phone-only sort select and arrange control, because its header row is hidden there.
     * @param {Object[]} entries - All Collections, for the arrange control
     * @returns {HTMLElement} The toolbar
     */
    const buildHubToolbar = (entries) => {
      const arranging = Boolean(getHubArrangement());
      const toolbar = el("div", "collections-toolbar");
      const tabs = el("div", "vendor-prices-tabs");
      tabs.setAttribute("role", "group");
      tabs.setAttribute("aria-label", "Filter collections by status");
      [
        [STATUS_ALL, "All"],
        [STATUS_PROGRESS, "In progress"],
        [STATUS_NOT_STARTED, "Not started"],
        [STATUS_COMPLETE, "Complete"],
      ].forEach(([value, label]) => {
        const tab = button(value === state.hubFilter ? "active" : "", `hubfilter:${value}`, () => {
          state.hubFilter = value;
          render();
        });
        tab.textContent = label;
        tab.setAttribute("aria-pressed", String(value === state.hubFilter));
        tab.disabled = arranging;
        tabs.appendChild(tab);
      });
      toolbar.appendChild(tabs);
      const right = el("div", "collections-toolbar-right");
      if (getViewMode() === VIEW_LEDGER) {
        const compact = el("div", "collections-hub-compact collections-show-sm");
        compact.appendChild(buildCompactSort());
        compact.appendChild(buildArrangeCell(entries));
        right.appendChild(compact);
      }
      right.appendChild(buildViewToggle(arranging));
      right.appendChild(
        buildPillButton({
          label: "Manage",
          icon: "gear",
          secondary: true,
          focusKey: "hub:manage",
          onClick: openCollectionsSettings,
        })
      );
      if (!arranging) {
        right.appendChild(
          buildPillButton({
            label: "New collection",
            icon: "plus",
            focusKey: "hub:new",
            onClick: () => callPicker("openBuilder", {}),
          })
        );
      }
      toolbar.appendChild(right);
      return toolbar;
    };

    /**
     * Name line for a hub entry.
     * @param {Object} entry - Entry view model
     * @param {string} className - Class for the wrapper
     * @returns {HTMLElement} The name line
     */
    const buildEntryName = (entry, className) => {
      const line = el("span", className);
      line.appendChild(el("b", "", entry.name));
      return line;
    };

    /**
     * Footer line of a hub card.
     * @param {Object} entry - Entry view model
     * @returns {string} Summary of what is left
     */
    const cardFootText = (entry) => {
      const { missing } = entry.progress;
      if (entry.status === STATUS_COMPLETE) {
        if (entry.retailDiffers)
          return `Set complete · ${money(entry.retail)} value · ${money(entry.melt)} melt`;
        // Known retail with no usable melt (no spot price) still shows its value.
        if (entry.retail && !entry.melt) return `Set complete · ${money(entry.retail)} value`;
        return entry.melt ? `Set complete · ${money(entry.melt)} melt` : "Set complete";
      }
      if (entry.costToComplete)
        return `${missing} missing ≈ ${money(entry.costToComplete)} to finish`;
      return `${missing} missing`;
    };

    /**
     * Medallion for a hub entry using the collection's selected image side.
     * @param {Object} entry - Entry view model
     * @param {string} [size] - Medallion size modifier
     * @returns {HTMLElement} The medallion
     */
    const buildEntryCoin = (entry, size) => {
      const definition = entry.isCustom ? entry.collection.definition : null;
      const side = definition?.side === "reverse" ? "reverse" : "obverse";
      const shownSide = entry[side] ? side : "obverse";
      const src = entry[shownSide];
      return buildCoin({
        src,
        monogram: entry.monogram,
        ghost: entry.progress.owned === 0,
        size,
        imageSide: side,
        resolvedImageSide: shownSide,
        stockImageSide: shownSide,
        imageLabel: entry.name,
        alt: `${shownSide} of ${entry.name}`,
        imageShape: entry.imageShape,
        imageOrientation: entry.imageOrientation,
        artwork: entry.isCustom ? { collectionId: entry.id, titleFallback: true } : null,
      });
    };

    /**
     * Applies one pointer or button move to the current draft and announces its position.
     * @param {Object} entry - Collection being moved
     * @param {string} targetId - Visible target id
     * @param {Object[]} visibleEntries - Entries shown in My order
     * @param {boolean} [after] - Place after the target
     * @returns {void}
     */
    const moveEntry = (entry, targetId, visibleEntries, after = false) => {
      const arrangement = getHubArrangement();
      if (!arrangement) return;
      const visibleIds = visibleEntries.map((candidate) => candidate.id);
      const nextOrder = sort.moveVisibleId(
        arrangement.order,
        visibleIds,
        entry.id,
        targetId,
        after
      );
      if (nextOrder.every((id, index) => id === arrangement.order[index])) return;
      const nextVisible = sort.orderEntries(visibleEntries, nextOrder);
      const position = nextVisible.findIndex((candidate) => candidate.id === entry.id) + 1;
      const activeFocusKey = document.activeElement?.dataset.focusKey || "";
      let focusKey = "";
      if (activeFocusKey === `hub:move-down:${entry.id}` && position === nextVisible.length)
        focusKey = `hub:move-up:${entry.id}`;
      else if (activeFocusKey === `hub:move-up:${entry.id}` && position === 1)
        focusKey = `hub:move-down:${entry.id}`;
      updateHubArrangement(
        nextOrder,
        `${entry.name} moved to position ${position} of ${nextVisible.length}.`,
        focusKey
      );
    };

    /**
     * Dedicated handle and touch-sized keyboard move buttons for one entry.
     * @param {Object} entry - Collection entry
     * @param {number} index - Position in the visible arrangement
     * @param {Object[]} visibleEntries - All enabled entries in My order
     * @returns {HTMLElement} Reorder control group
     */
    const buildArrangeControls = (entry, index, visibleEntries) => {
      const controls = el("div", "collections-arrange-controls");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", `Arrange ${entry.name}`);
      const handle = button("collections-arrange-handle", `hub:drag:${entry.id}`, () => {});
      handle.setAttribute("aria-label", `Drag ${entry.name} to reorder`);
      handle.title = `Drag ${entry.name} to reorder`;
      // Pointer-only affordance: keyboard users reorder with the move buttons (PR 1517 review).
      handle.tabIndex = -1;
      handle.appendChild(icon("grip"));
      wireReorderHandle(handle, {
        id: entry.id,
        itemSelector: "[data-hub-arrange-id]",
        idOf: (node) => node.dataset.hubArrangeId,
        isActive: () => Boolean(getHubArrangement()),
        onDrop: (targetId, after) => moveEntry(entry, targetId, visibleEntries, after),
      });
      controls.appendChild(handle);

      const up = button("collections-move-button", `hub:move-up:${entry.id}`, () => {
        if (index > 0) moveEntry(entry, visibleEntries[index - 1].id, visibleEntries);
      });
      up.textContent = "↑";
      up.setAttribute("aria-label", `Move ${entry.name} up`);
      up.disabled = index === 0;
      controls.appendChild(up);

      const down = button("collections-move-button", `hub:move-down:${entry.id}`, () => {
        if (index + 1 < visibleEntries.length)
          moveEntry(entry, visibleEntries[index + 1].id, visibleEntries, true);
      });
      down.textContent = "↓";
      down.setAttribute("aria-label", `Move ${entry.name} down`);
      down.disabled = index + 1 >= visibleEntries.length;
      controls.appendChild(down);
      return controls;
    };

    /**
     * One hub card (album mode). Arranging happens in the Ledger only (STRK-378).
     * @param {Object} entry - Entry view model
     * @returns {HTMLElement} The card
     */
    const buildHubCard = (entry) => {
      const card = button("collections-card", `open:${entry.id}`, () => openCollection(entry.id));
      card.dataset.collectionId = entry.id;
      card.appendChild(buildEntryCoin(entry));
      const body = el("span", "collections-card-body");
      body.appendChild(buildEntryName(entry, "collections-card-name"));
      body.appendChild(el("span", "collections-card-sub", entry.hubLine));
      const row = el("span", "collections-card-row");
      row.appendChild(buildCount(entry.progress));
      row.appendChild(el("span", "collections-pct", `${entry.progress.pct}%`));
      body.appendChild(row);
      body.appendChild(buildProgress(entry.progress));
      body.appendChild(el("span", "collections-card-foot", cardFootText(entry)));
      card.appendChild(body);
      return card;
    };

    /**
     * The dashed "New collection" card that closes the card grid.
     * @returns {HTMLButtonElement} The card
     */
    const buildNewCard = () => {
      const card = button("collections-card is-new", "hub:newcard", () =>
        callPicker("openBuilder", {})
      );
      card.appendChild(icon("plus"));
      card.appendChild(el("strong", "", "New collection"));
      card.appendChild(
        el(
          "span",
          "",
          "Blank checklist, or clone a template and add varieties, mint marks, proofs…"
        )
      );
      return card;
    };

    /**
     * One hub table row (ledger mode).
     * @param {Object} entry - Entry view model
     * @param {number} index - Position in visible My order while arranging
     * @param {Object[]} visibleEntries - All visible enabled entries
     * @returns {HTMLElement} The row or its arrangement wrapper
     */
    const buildHubRow = (entry, index, visibleEntries) => {
      const row = button("collections-lrow collections-hubrow", `open:${entry.id}`, () =>
        openCollection(entry.id)
      );
      row.dataset.collectionId = entry.id;
      row.appendChild(buildEntryCoin(entry, "sm"));
      const name = buildEntryName(entry, "collections-lrow-name");
      name.appendChild(el("small", "", entry.hubLine));
      row.appendChild(name);
      const progress = el("span", "collections-hubrow-progress");
      progress.appendChild(buildProgress(entry.progress));
      const compact = el("span", "collections-show-sm");
      compact.appendChild(buildCount(entry.progress));
      progress.appendChild(compact);
      row.appendChild(progress);
      const owned = el("span", "collections-num collections-hide-sm");
      owned.appendChild(buildCount(entry.progress));
      row.appendChild(owned);
      const valueCell = el(
        "span",
        "collections-num collections-hide-sm",
        entry.retail ? money(entry.retail) : DASH
      );
      if (entry.retailDiffers && entry.melt)
        valueCell.appendChild(el("small", "collections-value-melt", `${money(entry.melt)} melt`));
      row.appendChild(valueCell);
      row.appendChild(
        el("span", "collections-num collections-hide-sm", costLabel(entry.costToComplete))
      );
      if (!getHubArrangement()) {
        const chevron = icon("chevron");
        chevron.classList.add("collections-hide-sm");
        row.appendChild(chevron);
        return row;
      }
      row.classList.add("is-arranging");
      const item = el("div", "collections-arrange-item collections-arrange-ledger-item");
      item.dataset.hubArrangeId = entry.id;
      item.appendChild(row);
      item.appendChild(buildArrangeControls(entry, index, visibleEntries));
      return item;
    };

    /**
     * Header row for a ledger table.
     * @param {string} className - Extra class selecting the column template
     * @param {Array<[string, string]>} columns - [label, extra classes] per column
     * @returns {HTMLElement} The header row
     */
    const buildLedgerHead = (className, columns) => {
      const head = el("div", `collections-lrow is-head ${className}`.trim());
      columns.forEach(([label, classes]) => head.appendChild(el("span", classes, label)));
      return head;
    };

    /**
     * Hub body: cards or a table, by view mode.
     * @param {Object[]} entries - Enabled entry view models
     * @param {number} totalCount - Number of available entries before filtering
     * @returns {HTMLElement} The body
     */
    const buildHubBody = (entries, enabled, totalCount) => {
      if (totalCount > 0 && enabled.length === 0) {
        const empty = buildEmptyState(
          "All Collections are turned off",
          "Nothing was deleted. Turn Collections back on in Settings, or start a new one."
        );
        empty.classList.add("collections-all-off");
        const actions = el("div", "collections-all-off-actions");
        actions.appendChild(
          buildPillButton({
            label: "Open Collections settings",
            icon: "gear",
            focusKey: "hub:settings",
            onClick: openCollectionsSettings,
          })
        );
        actions.appendChild(
          buildPillButton({
            label: "New collection",
            icon: "plus",
            secondary: true,
            focusKey: "hub:all-off:new",
            onClick: () => callPicker("openBuilder", {}),
          })
        );
        empty.appendChild(actions);
        return empty;
      }

      const arrangement = getHubArrangement();
      const arranged = arrangement
        ? sort.orderEntries(entries, arrangement.order)
        : sort.sortHubEntries(entries, getHubPreferences());
      const enabledIds = new Set(enabled.map((entry) => entry.id));
      const visible = arranged.filter(
        (entry) =>
          enabledIds.has(entry.id) &&
          (arrangement || state.hubFilter === STATUS_ALL || entry.status === state.hubFilter)
      );
      if (getViewMode() === VIEW_LEDGER) {
        if (!visible.length)
          return buildEmptyState("Nothing here yet", "No collections match this filter.");
        const table = el("div", "collections-ledger");
        table.appendChild(buildHubHead(entries));
        visible.forEach((entry, index) => table.appendChild(buildHubRow(entry, index, visible)));
        return table;
      }
      const grid = el("div", "collections-grid");
      visible.forEach((entry) => grid.appendChild(buildHubCard(entry)));
      if (state.hubFilter === STATUS_ALL || !visible.length) grid.appendChild(buildNewCard());
      return grid;
    };

    /**
     * The hub view.
     * @param {{entries: Object[], enabled: Object[], hiddenCount: number, totalCount: number}} spec
     *   - All entries and visibility counts
     * @returns {HTMLElement} Hub panel content
     */
    const buildHub = ({ entries, enabled, hiddenCount, totalCount }) => {
      const hub = el("div", "collections-hub");
      hub.appendChild(buildHubHeader());
      // No first-run hero: an unstarted Series Template already shows as a ghosted 0 / N card
      // right below, so a "Start …" banner only repeated it. The stat strip appears once a
      // collection exists — before that every figure would be zero.
      const started = core().listCollections(store().getState()).length > 0;
      if (started) hub.appendChild(buildHubStats(enabled));
      hub.appendChild(buildHubToolbar(entries));
      // The Ledger shows its sort in the header; the Album needs the one-line hint instead.
      const hint = getViewMode() === VIEW_LEDGER || enabled.length === 0 ? null : buildSortHint();
      if (hint) hub.appendChild(hint);
      const announcement = el("div", "sr-only collections-arrange-status", state.hubAnnouncement);
      announcement.setAttribute("role", "status");
      announcement.setAttribute("aria-live", "polite");
      hub.appendChild(announcement);
      hub.appendChild(buildHubBody(entries, enabled, totalCount));
      if (hiddenCount > 0 && enabled.length > 0) {
        const note = el("div", "collections-hidden-note");
        note.appendChild(document.createTextNode(`${hiddenCount} hidden · `));
        const manage = button(
          "collections-hidden-manage",
          "hub:hidden-manage",
          openCollectionsSettings
        );
        manage.textContent = "Manage in Settings";
        note.appendChild(manage);
        hub.appendChild(note);
      }
      return hub;
    };

    return { buildHub, buildLedgerHead };
  };
})();

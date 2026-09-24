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
    } = deps;
    const sort = window.collectionsSort;
    const sortColumns = [
      ["name", "Collection"],
      ["progress", "Progress"],
      ["owned", "Owned"],
      ["melt", "Value (melt)"],
      ["cost", "To complete"],
    ];

    /** Select or reverse a hub column without changing saved Collection order.
     * @param {string} key - Column key
     * @returns {void}
     */
    const selectSort = (key) => {
      state.hubSort = sort.nextSort(state.hubSort, key);
      render();
    };

    /** Compact equivalent of the header actions for hidden mobile headers.
     * @returns {HTMLElement} Labelled select with both directions and default order
     */
    const buildCompactSort = () => {
      const label = el("label", "collections-hub-sort collections-show-sm", "Sort ");
      const select = el("select");
      select.setAttribute("aria-label", "Sort collections");
      select.dataset.focusKey = "hubsort:compact";
      const option = el("option", "", "Default order");
      option.value = "";
      select.appendChild(option);
      sortColumns.forEach(([key, name]) => {
        ["asc", "desc"].forEach((direction) => {
          const item = el(
            "option",
            "",
            `${name} — ${direction === "asc" ? "ascending" : "descending"}`
          );
          item.value = `${key}:${direction}`;
          select.appendChild(item);
        });
      });
      select.value = state.hubSort ? `${state.hubSort.key}:${state.hubSort.direction}` : "";
      select.addEventListener("change", () => {
        const [key, direction] = select.value.split(":");
        state.hubSort = key ? { key, direction } : null;
        render();
      });
      label.appendChild(select);
      return label;
    };

    /** Builds the hub's sortable header while leaving the shared Slot header static.
     * @returns {HTMLElement} Header with native keyboard buttons
     */
    const buildHubHead = () => {
      const head = el("div", "collections-lrow is-head collections-hubrow");
      head.appendChild(el("span"));
      sortColumns.forEach(([key, label], index) => {
        const active = state.hubSort?.key === key;
        const direction = active ? state.hubSort.direction : null;
        const control = button(
          `collections-sort-header ${index > 1 ? "collections-num" : ""}`,
          `hubsort:${key}`,
          () => selectSort(key)
        );
        control.appendChild(el("span", "", label));
        const indicator = el(
          "span",
          "collections-sort-indicator",
          active ? (direction === "asc" ? "↑" : "↓") : "↕"
        );
        indicator.setAttribute("aria-hidden", "true");
        control.appendChild(indicator);
        const status = active ? (direction === "asc" ? "ascending" : "descending") : "not sorted";
        control.setAttribute("aria-label", `Sort by ${label}, ${status}`);
        control.classList.toggle("is-active", active);
        head.appendChild(control);
      });
      head.appendChild(el("span"));
      return head;
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
          value: melt ? money(melt) : DASH,
          note: `melt · paid ${money(paid)}`,
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
     * Hub toolbar: status filter, view toggle, New collection.
     * @returns {HTMLElement} The toolbar
     */
    const buildHubToolbar = () => {
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
        tabs.appendChild(tab);
      });
      toolbar.appendChild(tabs);
      const right = el("div", "collections-toolbar-right");
      if (getViewMode() === VIEW_LEDGER) right.appendChild(buildCompactSort());
      right.appendChild(buildViewToggle());
      right.appendChild(
        buildPillButton({
          label: "New collection",
          icon: "plus",
          focusKey: "hub:new",
          onClick: () => callPicker("openBuilder", {}),
        })
      );
      toolbar.appendChild(right);
      return toolbar;
    };

    /**
     * Name line for a hub entry: name plus its Custom / Complete tags.
     * @param {Object} entry - Entry view model
     * @param {string} className - Class for the wrapper
     * @returns {HTMLElement} The name line
     */
    const buildEntryName = (entry, className) => {
      const line = el("span", className);
      line.appendChild(el("b", "", entry.name));
      if (entry.isCustom) line.appendChild(buildTag("Custom"));
      if (entry.status === STATUS_COMPLETE) line.appendChild(buildTag("Complete", "is-done"));
      return line;
    };

    /**
     * Footer line of a hub card.
     * @param {Object} entry - Entry view model
     * @returns {string} Summary of what is left
     */
    const cardFootText = (entry) => {
      const { missing } = entry.progress;
      if (entry.status === STATUS_COMPLETE)
        return entry.melt ? `Set complete · ${money(entry.melt)} melt` : "Set complete";
      if (entry.costToComplete)
        return `${missing} missing ≈ ${money(entry.costToComplete)} to finish`;
      return `${missing} missing`;
    };

    /**
     * Medallion for a hub entry: the template's stock obverse (ghosted until started),
     * or a monogram for a Custom Collection (its own cover art resolves afterwards).
     * @param {Object} entry - Entry view model
     * @param {string} [size] - Medallion size modifier
     * @returns {HTMLElement} The medallion
     */
    const buildEntryCoin = (entry, size) =>
      buildCoin({
        src: entry.obverse,
        monogram: entry.monogram,
        ghost: entry.progress.owned === 0,
        size,
        artwork: entry.isCustom ? { collectionId: entry.id } : null,
      });

    /**
     * One hub card (album mode).
     * @param {Object} entry - Entry view model
     * @returns {HTMLButtonElement} The card
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
     * @returns {HTMLButtonElement} The row
     */
    const buildHubRow = (entry) => {
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
      row.appendChild(
        el("span", "collections-num collections-hide-sm", entry.melt ? money(entry.melt) : DASH)
      );
      row.appendChild(
        el("span", "collections-num collections-hide-sm", costLabel(entry.costToComplete))
      );
      const chevron = icon("chevron");
      chevron.classList.add("collections-hide-sm");
      row.appendChild(chevron);
      return row;
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
     * @param {Object[]} entries - Entry view models
     * @returns {HTMLElement} The body
     */
    const buildHubBody = (entries) => {
      const visible = entries.filter(
        (entry) => state.hubFilter === STATUS_ALL || entry.status === state.hubFilter
      );
      if (getViewMode() === VIEW_LEDGER) {
        if (!visible.length)
          return buildEmptyState("Nothing here yet", "No collections match this filter.");
        const table = el("div", "collections-ledger");
        table.appendChild(buildHubHead());
        const selected = state.hubSort;
        const ordered = selected
          ? sort.sortRows(
              visible,
              (entry) => sort.hubKey(entry, selected.key),
              selected.direction,
              selected.key === "name" ? "text" : "number"
            )
          : visible;
        ordered.forEach((entry) => table.appendChild(buildHubRow(entry)));
        return table;
      }
      const grid = el("div", "collections-grid");
      visible.forEach((entry) => grid.appendChild(buildHubCard(entry)));
      if (state.hubFilter === STATUS_ALL || !visible.length) grid.appendChild(buildNewCard());
      return grid;
    };

    /**
     * The hub view.
     * @param {Object[]} entries - Entry view models
     * @returns {HTMLElement} Hub panel content
     */
    const buildHub = (entries) => {
      const hub = el("div", "collections-hub");
      hub.appendChild(buildHubHeader());
      // No first-run hero: an unstarted Series Template already shows as a ghosted 0 / N card
      // right below, so a "Start …" banner only repeated it. The stat strip appears once a
      // collection exists — before that every figure would be zero.
      const started = core().listCollections(store().getState()).length > 0;
      if (started) hub.appendChild(buildHubStats(entries));
      hub.appendChild(buildHubToolbar());
      hub.appendChild(buildHubBody(entries));
      return hub;
    };

    return { buildHub, buildLedgerHead };
  };
})();

// Collections album renderer. Loaded before collections-ui.js; the UI passes its shared
// DOM helpers and transient view state when it initializes this renderer.
(() => {
  "use strict";
  window.createCollectionsAlbumRenderer = (deps) => {
    const {
      el,
      button,
      icon,
      text,
      buildCoin,
      buildTag,
      runLabel,
      buildStats,
      money,
      costLabel,
      DASH,
      spotFor,
      buildSegmented,
      render,
      buildViewToggle,
      buildPillButton,
      callPicker,
      confirmRemoveCollection,
      openAddMenu,
      openMoreMenu,
      canMutate,
      unitPaid,
      unitMelt,
      PERCENT,
      quantityOf,
      viewItem,
      mintageLine,
      mintageCell,
      buildLedgerHead,
      getViewMode,
      VIEW_LEDGER,
      buildEmptyState,
      describeSlots,
      showHub,
      state,
      SLOTS_ALL,
      SLOTS_OWNED,
      SLOTS_MISSING,
      SORT_OLDEST,
      SORT_NEWEST,
    } = deps;
    let activeSlotNotePopover = null;
    let slotNotePopoverSequence = 0;
    // ---------------------------------------------------------------------------
    // Album
    // ---------------------------------------------------------------------------

    /**
     * Spec line parts for an album header.
     * @param {Object} entry - Entry view model
     * @returns {string[]} Parts, e.g. ["1 oz", ".999 fine silver", "40.6 mm", "$1 face value"]
     */
    const specParts = (entry) => {
      if (entry.isCustom) return [entry.metal].filter(Boolean);
      const template = entry.template;
      const specs = template.specs || {};
      return [
        template.weight ? `${template.weight} ${text(template.weightUnit) || "oz"}` : "",
        text(specs.fineness),
        specs.diameterMm ? `${specs.diameterMm} mm` : "",
        specs.faceValue ? `${text(specs.faceValue)} face value` : "",
      ].filter(Boolean);
    };

    /**
     * Album header: coin pair (or monogram), titles, spec line, about text, progress ring.
     * @param {Object} entry - Entry view model
     * @returns {HTMLElement} The header
     */
    const buildAlbumHead = (entry) => {
      const head = el("div", "collections-album-head");
      const pair = el("div", "collections-pair");
      if (entry.obverse) {
        pair.appendChild(buildCoin({ src: entry.obverse, size: "lg" }));
        if (entry.reverse) pair.appendChild(buildCoin({ src: entry.reverse, size: "lg" }));
      } else {
        pair.appendChild(
          buildCoin({
            monogram: entry.monogram,
            size: "lg",
            artwork: entry.isCustom ? { collectionId: entry.id } : null,
          })
        );
      }
      head.appendChild(pair);

      const info = el("div", "collections-album-info");
      const heading = el("h2", "", entry.name);
      if (entry.variant) heading.appendChild(buildTag(entry.variant, "is-variant"));
      if (entry.isCustom) heading.appendChild(buildTag("Custom"));
      info.appendChild(heading);
      const definition = entry.collection.definition || {};
      const subParts = entry.isCustom
        ? [
            "Custom collection",
            `${entry.slotDefs.length} slot${entry.slotDefs.length === 1 ? "" : "s"}`,
          ]
        : [
            text(entry.template.subtitle),
            runLabel(entry.template.run),
            text(entry.template.issuer),
          ];
      info.appendChild(el("p", "collections-sub", subParts.filter(Boolean).join(" · ")));
      const spec = el("div", "collections-spec");
      specParts(entry).forEach((part) => spec.appendChild(el("span", "", part)));
      if (spec.childElementCount) info.appendChild(spec);
      const about = entry.isCustom ? text(definition.description) : text(entry.template.about);
      if (about) info.appendChild(el("p", "collections-about", about));
      head.appendChild(info);

      const ring = el("div", "collections-ring");
      ring.style.setProperty("--collections-pct", String(entry.progress.pct));
      ring.setAttribute("role", "img");
      ring.setAttribute(
        "aria-label",
        `${entry.progress.pct}% complete: ${entry.progress.owned} of ${entry.progress.total}`
      );
      const ringBody = el("span");
      ringBody.appendChild(el("b", "", `${entry.progress.pct}%`));
      ringBody.appendChild(el("small", "", `${entry.progress.owned} of ${entry.progress.total}`));
      ring.appendChild(ringBody);
      head.appendChild(ring);
      return head;
    };

    /**
     * Album stat strip.
     * @param {Object} entry - Entry view model
     * @returns {HTMLElement} The strip
     */
    const buildAlbumStats = (entry) => {
      const { owned, total, missing } = entry.progress;
      const spot = spotFor(entry.metal);
      const spotNote = spot
        ? `${entry.metal.toLowerCase()} spot ${money(spot)}`
        : "per unit at today's spot";
      let costValue = costLabel(entry.costToComplete);
      if (!missing && total) costValue = "Done";
      return buildStats([
        {
          label: "Owned",
          value: String(owned),
          unit: `/ ${total}`,
          note: missing ? `${missing} still to find` : "every slot filled",
        },
        {
          label: "Paid",
          value: entry.paid ? money(entry.paid) : DASH,
          note: "primary items only · per unit",
        },
        { label: "Melt value", value: entry.melt ? money(entry.melt) : DASH, note: spotNote },
        {
          label: "Cost to complete",
          value: costValue,
          note: entry.best
            ? "floor est. · key dates carry premiums"
            : "floor est. · no vendor price available",
          accent: true,
        },
      ]);
    };

    /**
     * Album toolbar: slot filter, sort, view toggle, collection actions.
     * @param {Object} entry - Entry view model
     * @param {{owned: number, missing: number}} counts - Slot counts for the filter labels
     * @returns {HTMLElement} The toolbar
     */
    const buildAlbumToolbar = (entry, counts) => {
      const toolbar = el("div", "collections-toolbar");
      toolbar.appendChild(
        buildSegmented(
          "Filter slots",
          state.albumFilter,
          [
            [SLOTS_ALL, "All"],
            [SLOTS_OWNED, `Owned ${counts.owned}`],
            [SLOTS_MISSING, `Missing ${counts.missing}`],
          ],
          (value) => {
            state.albumFilter = value;
            render();
          }
        )
      );
      const right = el("div", "collections-toolbar-right");
      right.appendChild(el("span", "collections-toolbar-label", "Sort"));
      right.appendChild(
        buildSegmented(
          "Sort slots",
          state.albumSort,
          [
            [SORT_OLDEST, "Oldest"],
            [SORT_NEWEST, "Newest"],
          ],
          (value) => {
            state.albumSort = value;
            render();
          }
        )
      );
      right.appendChild(el("span", "collections-toolbar-label", "View"));
      right.appendChild(buildViewToggle());
      if (entry.isCustom) {
        right.appendChild(
          buildPillButton({
            label: "Edit collection",
            icon: "edit",
            secondary: true,
            focusKey: "album:edit",
            onClick: () => callPicker("openBuilder", { editId: entry.id }),
          })
        );
        right.appendChild(
          buildPillButton({
            label: "Remove collection",
            icon: "trash",
            danger: true,
            focusKey: "album:remove",
            onClick: () => void confirmRemoveCollection(entry),
          })
        );
      } else {
        right.appendChild(
          buildPillButton({
            label: "Clone & customize",
            icon: "copy",
            secondary: true,
            focusKey: "album:clone",
            onClick: () => callPicker("openBuilder", { cloneFrom: entry.id }),
          })
        );
      }
      toolbar.appendChild(right);
      return toolbar;
    };

    /**
     * Year / label heading of a slot, with its optional tag (e.g. "T2").
     * @param {Object} slot - Slot view model
     * @param {string} className - Wrapper class
     * @returns {HTMLElement} The heading
     */
    const buildSlotLabel = (slot, className) => {
      const heading = el("span", className);
      heading.appendChild(el("span", "collections-slot-label", slot.label));
      if (slot.tag) heading.appendChild(el("span", "collections-slot-tag", slot.tag));
      return heading;
    };

    /**
     * Closes the open Slot note popover and removes its temporary listeners.
     * @param {boolean} [restoreFocus] - Return keyboard focus to the triggering button
     * @returns {void}
     */
    const closeSlotNotePopover = (restoreFocus = false) => {
      if (!activeSlotNotePopover) return;
      const active = activeSlotNotePopover;
      activeSlotNotePopover = null;
      active.button.setAttribute("aria-expanded", "false");
      active.popover.hidden = true;
      active.origin.appendChild(active.popover);
      document.removeEventListener("pointerdown", active.onPointerDown, true);
      document.removeEventListener("focusin", active.onFocusIn, true);
      document.removeEventListener("keydown", active.onKeyDown, true);
      window.removeEventListener("scroll", active.onScroll, true);
      window.removeEventListener("resize", active.onResize);
      window.removeEventListener("hashchange", active.onHashChange);
      if (restoreFocus && active.button.isConnected) active.button.focus();
    };

    /**
     * Positions a note popover beside its trigger while keeping it inside the viewport.
     * @param {HTMLButtonElement} trigger - Note control
     * @param {HTMLElement} popover - Note content
     * @returns {void}
     */
    const positionSlotNotePopover = (trigger, popover) => {
      const margin = 12;
      const gap = 8;
      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - popoverRect.width - margin);
      const left = Math.min(Math.max(margin, triggerRect.left), maxLeft);
      const below = triggerRect.bottom + gap;
      const top =
        below + popoverRect.height <= window.innerHeight - margin
          ? below
          : Math.max(margin, triggerRect.top - popoverRect.height - gap);
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };

    /**
     * Builds an accessible disclosure control for the complete Slot note.
     * @param {Object} slot - Slot view model
     * @param {string} surface - Album or Ledger rendering context
     * @returns {{control: HTMLButtonElement, popover: HTMLElement}|null} The control and content
     */
    const buildSlotNoteControl = (slot, surface) => {
      if (!slot.note || !String(slot.note).trim()) return null;
      const noteId = `collections-slot-note-${++slotNotePopoverSequence}`;
      const popover = el("span", "collections-note-popover", slot.note);
      popover.id = noteId;
      popover.hidden = true;
      popover.setAttribute("role", "region");
      popover.setAttribute("aria-label", `Note for ${slot.label}`);
      const control = button(
        `collections-note-toggle is-${surface}`,
        `note:${slot.def.id}`,
        (event) => {
          event.stopPropagation();
          if (activeSlotNotePopover?.button === control) {
            closeSlotNotePopover();
            return;
          }
          closeSlotNotePopover();

          const origin = popover.parentElement;
          if (!origin) return;
          document.body.appendChild(popover);
          popover.hidden = false;
          positionSlotNotePopover(control, popover);
          control.setAttribute("aria-expanded", "true");

          const onPointerDown = (pointerEvent) => {
            if (!control.contains(pointerEvent.target) && !popover.contains(pointerEvent.target))
              closeSlotNotePopover();
          };
          const onFocusIn = (focusEvent) => {
            if (!control.contains(focusEvent.target) && !popover.contains(focusEvent.target))
              closeSlotNotePopover();
          };
          const onKeyDown = (keyEvent) => {
            if (keyEvent.key !== "Escape") return;
            keyEvent.preventDefault();
            keyEvent.stopPropagation();
            closeSlotNotePopover(true);
          };
          const onScroll = () => {
            if (!control.isConnected) {
              closeSlotNotePopover();
              return;
            }
            positionSlotNotePopover(control, popover);
          };
          const onResize = () => closeSlotNotePopover();
          const onHashChange = () => closeSlotNotePopover();
          activeSlotNotePopover = {
            button: control,
            popover,
            origin,
            onPointerDown,
            onFocusIn,
            onKeyDown,
            onScroll,
            onResize,
            onHashChange,
          };
          document.addEventListener("pointerdown", onPointerDown, true);
          document.addEventListener("focusin", onFocusIn, true);
          document.addEventListener("keydown", onKeyDown, true);
          window.addEventListener("scroll", onScroll, true);
          window.addEventListener("resize", onResize);
          window.addEventListener("hashchange", onHashChange);
        }
      );
      control.type = "button";
      control.setAttribute("aria-label", `Show note for ${slot.label}`);
      control.setAttribute("aria-controls", noteId);
      control.setAttribute("aria-expanded", "false");
      const iconMark = el("span", "collections-note-icon", "i");
      iconMark.setAttribute("aria-hidden", "true");
      control.appendChild(iconMark);
      return { control, popover };
    };

    /**
     * Builds the compact Slot identity block, with its optional Ledger note control.
     * @param {Object} slot - Slot view model
     * @param {string} surface - Album or Ledger rendering context
     * @returns {HTMLElement} Slot identity block
     */
    const buildSlotIdentity = (slot, surface) => {
      const identity = el("span", `collections-slot-identity is-${surface}`);
      const copy = el("span", "collections-slot-identity-copy");
      copy.appendChild(buildSlotLabel(slot, "collections-slot-identity-name"));
      const year = text(slot.def.year);
      if (year && year !== text(slot.label))
        copy.appendChild(el("small", "collections-slot-identity-year", year));
      identity.appendChild(copy);
      if (slot.note && String(slot.note).trim()) identity.classList.add("has-note");
      if (surface === "ledger") {
        const note = buildSlotNoteControl(slot, surface);
        if (note) {
          identity.appendChild(note.control);
          identity.appendChild(note.popover);
        }
      }
      return identity;
    };

    /**
     * "paid → melt (+x%)" for one unit of a linked Item.
     * @param {Object} item - Linked inventory item
     * @param {string} className - Wrapper class
     * @returns {HTMLElement} The money line
     */
    const buildMoneyLine = (item, className) => {
      const line = el("span", className);
      const paid = unitPaid(item);
      const melt = unitMelt(item);
      line.appendChild(document.createTextNode(money(paid)));
      if (!melt) return line;
      line.appendChild(document.createTextNode(` → ${money(melt)}`));
      if (paid > 0) {
        const pct = Math.round(((melt - paid) / paid) * PERCENT);
        line.appendChild(document.createTextNode(" "));
        line.appendChild(
          el(
            "span",
            pct >= 0 ? "collections-up" : "collections-down",
            `${pct >= 0 ? "+" : ""}${pct}%`
          )
        );
      }
      return line;
    };

    /**
     * What a missing slot offers instead of an Item: inventory matches, the best
     * current vendor price, or "Not owned".
     * @param {Object} entry - Entry view model
     * @param {Object} slot - Slot view model
     * @param {string} className - Class for the plain-text variants
     * @param {boolean} [showPrice=true] - False where the price has a column of its own (ledger)
     * @returns {HTMLElement} The hint
     */
    const buildMissingHint = (entry, slot, className, showPrice = true) => {
      if (slot.matches > 0) {
        const match = button("collections-match", `match:${slot.def.id}`, () =>
          callPicker("openLinkPicker", {
            collectionId: entry.id,
            slotId: slot.def.id,
            asSpare: false,
          })
        );
        match.textContent = `${slot.matches} match${slot.matches === 1 ? "" : "es"} in your inventory`;
        return match;
      }
      if (entry.best && showPrice) {
        const price = el(
          "span",
          `${className} collections-slot-price`,
          `from ${money(entry.best.price)}`
        );
        price.appendChild(el("small", "", ` · ${entry.best.vendor}`));
        return price;
      }
      return el("span", className, "Not owned");
    };

    /**
     * "+ Add" pill for a missing slot.
     * @param {Object} entry - Entry view model
     * @param {Object} slot - Slot view model
     * @returns {HTMLButtonElement} The button
     */
    const buildAddButton = (entry, slot) => {
      const add = buildPillButton({
        label: "Add",
        icon: "plus",
        secondary: true,
        focusKey: `add:${slot.def.id}`,
        onClick: () => openAddMenu(add, entry, slot, false),
      });
      add.classList.add("collections-add");
      add.setAttribute("aria-haspopup", "menu");
      add.setAttribute("aria-expanded", "false");
      add.setAttribute("aria-label", `Add an item to the ${slot.label} slot`);
      return add;
    };

    /**
     * "More" (⋯) button for an owned slot.
     * @param {Object} entry - Entry view model
     * @param {Object} slot - Slot view model
     * @returns {HTMLButtonElement} The button
     */
    const buildMoreButton = (entry, slot) => {
      const more = button("collections-more", `more:${slot.def.id}`, (event) => {
        event.stopPropagation();
        openMoreMenu(more, entry, slot);
      });
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-expanded", "false");
      more.setAttribute("aria-label", `More actions for the ${slot.label} slot`);
      more.appendChild(icon("more"));
      return more;
    };

    /**
     * Medallion for a slot: stock image (ghosted while missing); an owned slot is
     * marked so the async pass can swap in the linked Item's own photo.
     * @param {Object} entry - Entry view model
     * @param {Object} slot - Slot view model
     * @param {string} [size] - Medallion size modifier
     * @returns {HTMLElement} The medallion
     */
    const buildSlotCoin = (entry, slot, size) => {
      const side =
        entry.isCustom && entry.collection.definition?.side === "reverse" ? "reverse" : "obverse";
      const src = entry[side] || entry.obverse;
      const stockSide = entry[side] ? side : "obverse";
      const displayedSide = src ? stockSide : side;
      return buildCoin({
        src,
        monogram: entry.monogram,
        ghost: !slot.item,
        owned: Boolean(slot.item),
        size,
        alt: `${displayedSide} of ${slot.label}`,
        imageLabel: slot.label,
        imageSide: side,
        resolvedImageSide: displayedSide,
        stockImageSide: src ? stockSide : "",
        itemUuid: slot.item ? slot.item.uuid : "",
        artwork: entry.isCustom ? { collectionId: entry.id, slotId: slot.def.id } : null,
      });
    };

    /**
     * One slot tile (album mode).
     * @param {Object} entry - Entry view model
     * @param {Object} slot - Slot view model
     * @returns {HTMLElement} The tile
     */
    const buildSlotTile = (entry, slot) => {
      const tile = el(
        "div",
        slot.item ? "collections-slot is-owned" : "collections-slot is-missing"
      );
      tile.dataset.slotId = slot.def.id;
      tile.setAttribute("role", "listitem");
      const mintage = mintageLine(slot.def);

      if (!slot.item) {
        tile.appendChild(buildSlotCoin(entry, slot));
        tile.appendChild(buildSlotIdentity(slot, "album"));
        const note = buildSlotNoteControl(slot, "album");
        if (note) {
          tile.appendChild(note.control);
          tile.appendChild(note.popover);
        }
        tile.appendChild(el("span", "collections-slot-meta", mintage || " "));
        tile.appendChild(el("span", "collections-slot-rule"));
        tile.appendChild(buildMissingHint(entry, slot, "collections-slot-meta"));
        if (canMutate()) tile.appendChild(buildAddButton(entry, slot));
        return tile;
      }

      // The main button carries the whole face of the tile; badges and the "more" button
      // are its SIBLINGS, never its children — interactive controls must not nest.
      const main = button("collections-slot-main", `slot:${slot.def.id}`, () =>
        viewItem(slot.item.uuid)
      );
      main.appendChild(buildSlotCoin(entry, slot));
      main.appendChild(buildSlotIdentity(slot, "album"));
      main.appendChild(el("span", "collections-slot-meta", mintage || " "));
      main.appendChild(el("span", "collections-slot-rule"));
      const name = el("span", "collections-slot-item", text(slot.item.name) || "Untitled item");
      name.title = name.textContent;
      main.appendChild(name);
      const moneyLine = buildMoneyLine(slot.item, "collections-slot-money");
      if (quantityOf(slot.item) > 1)
        moneyLine.appendChild(el("span", "collections-qty", `×${quantityOf(slot.item)}`));
      main.appendChild(moneyLine);
      tile.appendChild(main);
      const note = buildSlotNoteControl(slot, "album");
      if (note) {
        tile.appendChild(note.control);
        tile.appendChild(note.popover);
      }

      const check = el("span", "collections-check");
      check.appendChild(icon("check"));
      check.setAttribute("aria-hidden", "true");
      tile.appendChild(check);
      if (slot.spares.length) {
        const spare = el("span", "collections-spare", `+${slot.spares.length}`);
        spare.title = `${slot.spares.length} spare${slot.spares.length === 1 ? "" : "s"}`;
        tile.appendChild(spare);
      }
      if (canMutate()) tile.appendChild(buildMoreButton(entry, slot));
      return tile;
    };

    /**
     * Secondary line under a linked Item's name in the ledger: where and when it was bought.
     * @param {Object} item - Linked inventory item
     * @returns {string} "APMEX · 2024-03-14" style line
     */
    const purchaseLine = (item) => {
      const when =
        item.date && typeof formatDisplayDate === "function" ? formatDisplayDate(item.date) : "";
      return [text(item.purchaseLocation), text(when)].filter(Boolean).join(" · ");
    };

    /**
     * One slot row (ledger mode). Below 640px the numeric columns hide and the row
     * becomes two lines: thumb | year + item / status or price | action.
     * @param {Object} entry - Entry view model
     * @param {Object} slot - Slot view model
     * @returns {HTMLElement} The row
     */
    const buildSlotRow = (entry, slot) => {
      const row = el(
        "div",
        slot.item ? "collections-lrow is-owned" : "collections-lrow is-missing"
      );
      row.dataset.slotId = slot.def.id;
      row.setAttribute("role", "listitem");
      row.appendChild(buildSlotCoin(entry, slot, "sm"));
      row.appendChild(buildSlotIdentity(slot, "ledger"));
      const name = el("span", "collections-lrow-name");
      /**
       * A right-aligned numeric cell; hidden in the compact (<=640px) row.
       * @param {string} value - Cell text
       * @param {string} [extra] - Extra classes
       * @returns {HTMLElement} The cell
       */
      const numeric = (value, extra) =>
        el("span", `collections-num collections-hide-sm ${extra || ""}`.trim(), value);

      if (!slot.item) {
        // The price has its own column here; the compact row folds it into line two instead.
        name.appendChild(buildMissingHint(entry, slot, "collections-muted", false));
        if (entry.best)
          name.appendChild(
            el(
              "small",
              "collections-show-sm",
              `from ${money(entry.best.price)} · ${entry.best.vendor}`
            )
          );
        row.appendChild(name);
        row.appendChild(numeric(mintageCell(slot.def), "collections-muted collections-hide-md"));
        row.appendChild(numeric(DASH, "collections-muted"));
        row.appendChild(numeric(DASH, "collections-muted"));
        row.appendChild(numeric(entry.best ? `from ${money(entry.best.price)}` : DASH));
        const act = el("span", "collections-lrow-act");
        if (canMutate()) act.appendChild(buildAddButton(entry, slot));
        row.appendChild(act);
        return row;
      }

      const item = slot.item;
      const open = button("collections-linkbtn", `slot:${slot.def.id}`, () => viewItem(item.uuid));
      open.textContent = text(item.name) || "Untitled item";
      open.title = open.textContent;
      name.appendChild(open);
      if (quantityOf(item) > 1)
        name.appendChild(el("span", "collections-qty", `×${quantityOf(item)}`));
      if (slot.spares.length)
        name.appendChild(
          buildTag(`+${slot.spares.length} spare${slot.spares.length === 1 ? "" : "s"}`)
        );
      const purchase = purchaseLine(item);
      if (purchase) name.appendChild(el("small", "collections-hide-sm", purchase));
      name.appendChild(buildMoneyLine(item, "collections-lrow-money collections-show-sm"));
      row.appendChild(name);

      const paid = unitPaid(item);
      const melt = unitMelt(item);
      row.appendChild(numeric(mintageCell(slot.def), "collections-muted collections-hide-md"));
      row.appendChild(numeric(money(paid)));
      row.appendChild(numeric(melt ? money(melt) : DASH));
      const delta = melt - paid;
      row.appendChild(
        melt
          ? numeric(
              `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))}`,
              delta >= 0 ? "collections-up" : "collections-down"
            )
          : numeric(DASH, "collections-muted")
      );
      const act = el("span", "collections-lrow-act");
      act.appendChild(buildTag("Owned", "is-done"));
      if (canMutate()) act.appendChild(buildMoreButton(entry, slot));
      row.appendChild(act);
      // Convenience only — the row is not the control; the name button is.
      row.addEventListener("click", (event) => {
        if (!event.target.closest("button")) viewItem(item.uuid);
      });
      return row;
    };

    /**
     * Album body: tiles or rows by view mode, or a message when the filter matches nothing.
     * @param {Object} entry - Entry view model
     * @param {Object[]} slots - Visible slot view models
     * @returns {HTMLElement} The body
     */
    const buildAlbumBody = (entry, slots) => {
      if (!slots.length) {
        if (state.albumFilter === SLOTS_OWNED)
          return buildEmptyState(
            "No slots filled yet",
            "Link an item from your inventory, or add a new one, to fill your first slot."
          );
        if (state.albumFilter === SLOTS_MISSING)
          return buildEmptyState(
            "Nothing missing — set complete",
            "Every slot in this collection has a linked item."
          );
        return buildEmptyState("No slots yet", "This collection does not define any slots.");
      }
      if (getViewMode() === VIEW_LEDGER) {
        const table = el("div", "collections-ledger");
        table.setAttribute("role", "list");
        table.appendChild(
          buildLedgerHead("", [
            ["", ""],
            ["Slot", ""],
            ["Linked item", ""],
            ["Mintage", "collections-num collections-hide-md"],
            ["Paid", "collections-num"],
            ["Melt", "collections-num"],
            ["G/L · Best price", "collections-num"],
            ["", ""],
          ])
        );
        slots.forEach((slot) => table.appendChild(buildSlotRow(entry, slot)));
        return table;
      }
      const grid = el("div", "collections-slots");
      grid.setAttribute("role", "list");
      slots.forEach((slot) => grid.appendChild(buildSlotTile(entry, slot)));
      return grid;
    };

    /**
     * The in-page album view.
     * @param {Object} entry - Entry view model
     * @returns {HTMLElement} Album panel content
     */
    const buildAlbum = (entry) => {
      closeSlotNotePopover();
      const album = el("div", "collections-album");
      const crumb = el("nav", "collections-crumb");
      crumb.setAttribute("aria-label", "Breadcrumb");
      const back = button("", "album:back", () => {
        closeSlotNotePopover();
        showHub();
      });
      back.appendChild(icon("back"));
      back.appendChild(el("span", "", "Collections"));
      crumb.appendChild(back);
      crumb.appendChild(el("span", "", "/"));
      const here = el("span", "", [entry.name, entry.variant].filter(Boolean).join(" — "));
      here.setAttribute("aria-current", "page");
      crumb.appendChild(here);
      album.appendChild(crumb);

      const described = describeSlots(entry);
      album.appendChild(buildAlbumHead(entry));
      album.appendChild(buildAlbumStats(entry));
      album.appendChild(buildAlbumToolbar(entry, described));
      album.appendChild(buildAlbumBody(entry, described.slots));
      return album;
    };

    return { buildAlbum, closeSlotNotePopover };
  };
})();

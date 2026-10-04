// COLLECTIONS PICKER + BUILDER (STRK-368, epic STRK-254)
// =============================================================================
// Two dialogs for the Collections tab, reached through the seam js/collections-ui.js
// calls:  window.collectionsPicker.openLinkPicker({ collectionId, slotId, asSpare })
//         window.collectionsPicker.openBuilder({ cloneFrom, editId })
//
// LINK PICKER — choose an existing ACTIVE inventory Item for a Slot. Name matching
// only ever SUGGESTS (suggestions are pinned on top); the link is always an explicit
// click. Items already linked elsewhere in this Collection are shown but disabled,
// because an Item fills at most one Slot per Collection.
//
// BUILDER — create a Custom Collection (blank, or cloned from a Series Template) or
// edit one. Slots that keep their row keep their id, so renaming never drops a link.
//
// Everything is DOM-built with textContent: item names, collection names, slot labels
// and notes are user-authored and never reach innerHTML.
//
// CUSTOM IMAGES live in the existing patternImages IndexedDB store under ids that can
// never collide with a Numista pattern rule ("collection--<id>" for the cover,
// "collection--<id>--<slotId>" for a slot), so they ride the image backup/restore that
// store already has. The ZIP backup uses these ids as FILE NAMES, so they must stay
// filename-safe on every OS (no colons); "--" cannot occur inside an id because slugs
// collapse to single hyphens. MUST load after collections-store.js.
// =============================================================================

(() => {
  "use strict";

  const PICKER_MODAL_ID = "collectionsPickerModal";
  const BUILDER_MODAL_ID = "collectionsBuilderModal";

  /** Most rows rendered in the "all items" list before asking the user to search. */
  const MAX_LISTED_ITEMS = 60;

  /** Largest year range the "Add year range" shortcut will generate in one go. */
  const MAX_YEAR_RANGE = 200;

  const METALS = ["Silver", "Gold", "Platinum", "Palladium", "Copper", "Mixed"];

  /** Chemical symbols for the picker's metal badge. */
  const METAL_SYMBOLS = Object.assign(Object.create(null), {
    silver: "Ag",
    gold: "Au",
    platinum: "Pt",
    palladium: "Pd",
    copper: "Cu",
  });

  const REASON_LABELS = Object.assign(Object.create(null), {
    name: "name match",
    abbreviation: "abbreviation match",
    keyword: "partial name match",
    year: "year match",
    variant: "variant match",
  });

  const LINK_ERRORS = Object.assign(Object.create(null), {
    "already-linked": "That item already fills another slot in this collection.",
    occupied: "That slot already has a primary item.",
    "spares-full": "That slot already holds the maximum number of spares.",
    "no-collection": "That collection no longer exists.",
    "save-failed": "Could not save — storage may be full.",
  });

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  /**
   * Creates an element with an optional class list and text content.
   * @param {string} tag - Tag name
   * @param {string} [className] - Space-separated classes
   * @param {string} [textContent] - Text content (never parsed as HTML)
   * @returns {HTMLElement} The element
   */
  const el = (tag, className, textContent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent != null) node.textContent = String(textContent);
    return node;
  };

  /**
   * Creates a button wired to a click handler.
   * @param {string} className - Classes
   * @param {string} label - Visible label
   * @param {Function} onClick - Click handler
   * @returns {HTMLButtonElement} The button
   */
  const button = (className, label, onClick) => {
    const node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  };

  /**
   * Shows a transient message when the toast helper is available.
   * @param {string} message - Message text
   * @returns {void}
   */
  const toast = (message) => {
    if (typeof window.showToast === "function") window.showToast(message);
  };

  /**
   * Formats a per-unit price in the user's display currency when the app helper exists.
   * @param {number} value - Amount
   * @returns {string} Formatted amount
   */
  const money = (value) => {
    const amount = Number(value) || 0;
    return typeof formatCurrency === "function" ? formatCurrency(amount) : `$${amount.toFixed(2)}`;
  };

  /**
   * Builds (once) a modal shell that the app's modal helpers can open and close.
   * @param {string} id - Modal element id
   * @param {string} extraClass - Modifier class for the dialog
   * @returns {{modal: HTMLElement, title: HTMLElement, subtitle: HTMLElement, body: HTMLElement,
   *   footer: HTMLElement}} Shell parts
   */
  const ensureModal = (id, extraClass) => {
    let modal = document.getElementById(id);
    if (!modal) {
      modal = el("div", "modal collections-modal");
      modal.id = id;
      modal.style.display = "none";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", `${id}Title`);
      const content = el("div", `modal-content collections-modal-content ${extraClass}`);
      const header = el("div", "collections-modal-header");
      const title = el("h2", "collections-modal-title");
      title.id = `${id}Title`;
      const close = button("modal-close", "×", () => closeModalById(id));
      close.setAttribute("aria-label", "Close");
      header.append(title, el("p", "collections-modal-subtitle"), close);
      content.append(
        header,
        el("div", "collections-modal-body"),
        el("div", "collections-modal-footer")
      );
      modal.appendChild(content);
      modal.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          // The builder can sit over Settings; keep the global handler from closing
          // both layers. The link picker retains its existing Escape propagation.
          if (id === BUILDER_MODAL_ID) event.stopPropagation();
          closeModalById(id);
        }
      });
      document.body.appendChild(modal);
    }
    return {
      modal,
      title: modal.querySelector(".collections-modal-title"),
      subtitle: modal.querySelector(".collections-modal-subtitle"),
      body: modal.querySelector(".collections-modal-body"),
      footer: modal.querySelector(".collections-modal-footer"),
    };
  };

  // ---------------------------------------------------------------------------
  // Shared lookups
  // ---------------------------------------------------------------------------

  /**
   * The collection record, its template and slot definitions — works for a Series
   * Template that has not been started yet (no state record).
   * @param {string} collectionId - Collection id or template slug
   * @returns {{collection: Object|null, template: Object|null, slots: Object[], title: string}} Context
   */
  const contextFor = (collectionId) => {
    const store = window.collectionsStore;
    const collection = store.getState().collections[collectionId] || null;
    const live = collection && !collection.deletedAt ? collection : null;
    const template = live ? store.templateFor(live) : store.getTemplate(collectionId);
    const slots = live ? store.slotDefs(live) : (template && template.slots) || [];
    const templateTitle = template
      ? `${template.name}${template.variant ? ` — ${template.variant}` : ""}`
      : "";
    return {
      collection: live,
      template,
      slots,
      title: (live && live.name) || templateTitle || "Collection",
    };
  };

  /**
   * Matching profile for suggestions: the template, or a custom collection's own metal
   * and name.
   * @param {{collection: Object|null, template: Object|null}} context - Collection context
   * @returns {Object} Profile for collectionsCore.suggestItemsForSlot
   */
  const profileFor = (context) => {
    if (context.template) return context.template;
    const definition = (context.collection && context.collection.definition) || {};
    const metal = definition.metal && definition.metal !== "Mixed" ? definition.metal : "";
    const name = (context.collection && context.collection.name) || "";
    return { metal, match: { names: name ? [name] : [], abbreviations: [], keywords: [] } };
  };

  /**
   * Every uuid already linked in a collection, mapped to the slot label holding it.
   * @param {{collection: Object|null, slots: Object[]}} context - Collection context
   * @returns {Map<string, string>} uuid → slot label
   */
  const linkedUuids = (context) => {
    const used = new Map();
    if (!context.collection) return used;
    const labels = Object.create(null);
    context.slots.forEach((slot) => {
      labels[slot.id] = slot.label || String(slot.year || slot.id);
    });
    Object.keys(context.collection.slots).forEach((slotId) => {
      const link = context.collection.slots[slotId];
      [link.primary, ...link.spares]
        .filter(Boolean)
        .forEach((uuid) => used.set(uuid, labels[slotId] || slotId));
    });
    return used;
  };

  // ---------------------------------------------------------------------------
  // Link picker
  // ---------------------------------------------------------------------------

  /**
   * An item's weight as the inventory table shows it. For the metric/troy units `item.weight`
   * is stored in troy oz whatever unit is displayed (gb/sb store a denomination, cu a face
   * value), so printing the raw number beside the unit mislabels it (0.999984 ozt read as
   * "0.999984 g" — STRK-398). formatWeight handles every unit, converting back for display.
   * @param {Object} item - Inventory item
   * @returns {string} Display weight, or "" when unknown
   */
  const weightLabel = (item) => {
    if (!item.weight || typeof formatWeight !== "function") return "";
    return formatWeight(item.weight, item.weightUnit, item);
  };

  /**
   * Marks the chip for the current mode as pressed.
   * @param {HTMLElement} group - Control from yearFilterToggle
   * @param {boolean} yearOnly - Whether the list is filtered to the slot's year
   * @returns {void}
   */
  const syncYearFilter = (group, yearOnly) => {
    group.querySelectorAll(".chip-sort-btn").forEach((chip) => {
      const pressed = chip.dataset.yearOnly === String(yearOnly);
      chip.classList.toggle("active", pressed);
      chip.setAttribute("aria-pressed", String(pressed));
    });
  };

  /**
   * The "<year> only" / "All items" chip pair shown for a dated slot (STRK-398). The control
   * keeps its own pressed state; the caller only hears which mode was chosen.
   * @param {string} year - The slot's year
   * @param {boolean} yearOnly - Initial mode
   * @param {(yearOnly: boolean) => void} onChange - Called with the chosen mode
   * @returns {HTMLElement} Segmented control
   */
  const yearFilterToggle = (year, yearOnly, onChange) => {
    const group = el("div", "chip-sort-toggle");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Year filter");
    [
      [true, `${year} only`],
      [false, "All items"],
    ].forEach(([mode, label]) => {
      const chip = button("chip-sort-btn", label, () => {
        syncYearFilter(group, mode);
        onChange(mode);
      });
      chip.dataset.yearOnly = String(mode);
      group.appendChild(chip);
    });
    syncYearFilter(group, yearOnly);
    return group;
  };

  /**
   * One item row in the picker.
   * @param {Object} item - Inventory item
   * @param {{reasons?: string[], usedIn?: string, onLink: Function}} options - Row options
   * @returns {HTMLElement} Row element
   */
  const pickerRow = (item, options) => {
    const row = el("div", "collections-pick");
    if (options.reasons) row.classList.add("is-suggested");
    if (options.usedIn) row.classList.add("is-disabled");
    row.dataset.uuid = item.uuid;

    const badge = el(
      "span",
      "collections-pick-metal",
      METAL_SYMBOLS[String(item.metal || "").toLowerCase()] || "?"
    );
    const main = el("div", "collections-pick-main");
    main.appendChild(el("div", "collections-pick-name", item.name || "Unnamed item"));
    const meta = [
      item.year || "no year",
      item.metal,
      weightLabel(item),
      item.purchaseLocation,
      item.date,
    ].filter(Boolean);
    const metaLine = el("div", "collections-pick-meta", meta.join(" · "));
    if (options.reasons) {
      const why = options.reasons.map((reason) => REASON_LABELS[reason] || reason).join(" + ");
      metaLine.appendChild(el("span", "collections-pick-why", ` · ${why}`));
    }
    main.appendChild(metaLine);

    row.append(badge, main, el("span", "collections-pick-price", money(item.price)));
    if (options.usedIn) {
      row.appendChild(el("span", "collections-pick-used", `in ${options.usedIn} slot`));
    } else {
      const link = button("btn collections-btn-pill", "Link", () => options.onLink(item));
      link.setAttribute("aria-label", `Link ${item.name || "item"}`);
      row.appendChild(link);
    }
    return row;
  };

  /**
   * Opens the link picker for a slot.
   * @param {{collectionId: string, slotId: string, asSpare?: boolean}} request - Target slot
   * @returns {void}
   */
  const openLinkPicker = (request) => {
    const store = window.collectionsStore;
    const context = contextFor(request.collectionId);
    const slot = context.slots.find((def) => def.id === request.slotId);
    if (!slot) return;
    const shell = ensureModal(PICKER_MODAL_ID, "collections-modal-content--picker");
    const slotLabel = `${slot.label || slot.year || slot.id}${slot.tag ? ` ${slot.tag}` : ""}`;
    shell.title.textContent = `${request.asSpare ? "Add a spare" : "Link an item"} — ${slotLabel} slot`;
    shell.subtitle.textContent = `${context.title} · links are stored on the collection; the item itself is never changed.`;

    const used = linkedUuids(context);
    const active = store.activeItems();
    const suggestions = window.collectionsCore.suggestItemsForSlot(
      profileFor(context),
      slot,
      active,
      {
        normalizeName: window.autocomplete && window.autocomplete.normalizeItemName,
        excludeUuids: new Set(used.keys()),
      }
    );
    const suggestedIds = new Set(suggestions.map((entry) => entry.item.uuid));

    const onLink = (item) => {
      const result = store.link(request.collectionId, request.slotId, item.uuid, {
        asSpare: request.asSpare,
      });
      if (!result.ok) {
        toast(LINK_ERRORS[result.reason] || "Could not link that item.");
        return;
      }
      closeModalById(PICKER_MODAL_ID);
      toast(
        `Linked “${item.name || "item"}” to the ${slotLabel} slot${request.asSpare ? " as a spare" : ""}.`
      );
    };

    const search = el("input", "collections-pick-search");
    search.type = "search";
    search.placeholder = "Search active inventory by name, year, metal, source…";
    search.setAttribute("aria-label", "Search inventory");
    const list = el("div", "collections-pick-list");

    // A dated slot opens on its own year; suggestions stay pinned in both modes (STRK-398).
    const slotYear = slot.year == null ? "" : String(slot.year).trim();
    let yearOnly = slotYear !== "";
    const inYear = (item) => !yearOnly || window.collectionsCore.itemYear(item) === slotYear;

    const renderList = () => {
      const query = search.value.trim().toLowerCase();
      const matches = (item) =>
        !query ||
        [item.name, item.year, item.metal, item.purchaseLocation, item.type]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(query));
      list.replaceChildren();

      const suggested = suggestions.filter((entry) => matches(entry.item));
      if (suggested.length) {
        list.appendChild(el("div", "collections-pick-group", "Suggested matches"));
        suggested.forEach((entry) =>
          list.appendChild(pickerRow(entry.item, { reasons: entry.reasons, onLink }))
        );
      } else if (!query) {
        list.appendChild(
          el(
            "p",
            "collections-pick-note",
            `No obvious match for the ${slotLabel} slot — search below, or add a new item.`
          )
        );
      }

      const rest = active.filter(
        (item) => !suggestedIds.has(item.uuid) && inYear(item) && matches(item)
      );
      const heading = el(
        "div",
        "collections-pick-group is-muted",
        yearOnly ? `Active ${slotYear} items` : "All active items"
      );
      heading.appendChild(
        el("span", "collections-pick-group-note", " · disposed items are never shown")
      );
      list.appendChild(heading);
      rest
        .slice(0, MAX_LISTED_ITEMS)
        .forEach((item) =>
          list.appendChild(pickerRow(item, { usedIn: used.get(item.uuid), onLink }))
        );
      if (!rest.length) {
        const empty = yearOnly
          ? `No other ${slotYear} items — choose All items to see everything.`
          : "No items match.";
        list.appendChild(el("p", "collections-pick-note", empty));
      }
      if (rest.length > MAX_LISTED_ITEMS) {
        const more = rest.length - MAX_LISTED_ITEMS;
        list.appendChild(
          el("p", "collections-pick-note", `${more} more — refine the search to narrow the list.`)
        );
      }
    };
    search.addEventListener("input", renderList);
    const yearFilter = slotYear
      ? yearFilterToggle(slotYear, yearOnly, (mode) => {
          yearOnly = mode;
          renderList();
        })
      : null;

    shell.body.replaceChildren(...[search, yearFilter, list].filter(Boolean));
    shell.footer.replaceChildren(
      button("collections-textlink", "+ Add a new item instead", () => {
        closeModalById(PICKER_MODAL_ID);
        store.requestNewItem(request.collectionId, request.slotId, { asSpare: request.asSpare });
      }),
      button("btn secondary collections-btn-pill", "Cancel", () => closeModalById(PICKER_MODAL_ID))
    );
    renderList();
    openModalById(PICKER_MODAL_ID);
  };

  // ---------------------------------------------------------------------------
  // Custom images (patternImages store)
  // ---------------------------------------------------------------------------

  /**
   * Storage id for a custom collection image.
   * @param {string} collectionId - Collection id
   * @param {string} [slotId] - Slot id; omit for the collection cover
   * @returns {string} patternImages record id
   */
  const imageId = (collectionId, slotId) =>
    slotId === "title:reverse"
      ? `collection--${collectionId}--@title-reverse`
      : slotId
        ? `collection--${collectionId}--${slotId}`
        : `collection--${collectionId}`;

  /** Stable content token for equal-time artwork edits on separate devices. */
  const imageDigest = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      return Array.from(digest, (part) => part.toString(16).padStart(2, "0")).join("");
    }
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
  };

  /**
   * Whether custom images can be stored on this device.
   * @returns {boolean} True when the image cache and processor are ready
   */
  const imagesAvailable = () =>
    Boolean(window.imageCache && window.imageCache.isAvailable() && window.imageProcessor);

  /**
   * Resizes/compresses an uploaded file and stores it as a collection image.
   * @param {string} collectionId - Collection id
   * @param {string|null} slotId - Slot id, or null for the cover
   * @param {File} file - Uploaded image file
   * @returns {Promise<boolean>} Whether the image was stored
   */
  const saveImage = async (collectionId, slotId, file) => {
    if (!imagesAvailable() || !file) return false;
    try {
      const processed = await window.imageProcessor.processFile(file, {
        maxDim: typeof IMAGE_MAX_DIM === "number" ? IMAGE_MAX_DIM : undefined,
        maxBytes: typeof IMAGE_MAX_BYTES === "number" ? IMAGE_MAX_BYTES : undefined,
      });
      if (!processed || !processed.blob) return false;
      const digest = await imageDigest(processed.blob);
      const id = imageId(collectionId, slotId);
      const collection = window.collectionsStore.getState().collections[collectionId];
      const key =
        slotId == null ? "cover" : slotId === "title:reverse" ? "title:reverse" : `slot:${slotId}`;
      const prior = collection && collection.artwork[key];
      const priorTime = prior ? Date.parse(prior.modified) : 0;
      const cachedAt = Math.max(Date.now(), Number.isFinite(priorTime) ? priorTime + 1 : 0);
      const previousRecord = await window.imageCache.getPatternImage(id);
      const stored = await window.imageCache.importPatternImageRecord({
        ruleId: id,
        obverse: processed.blob,
        reverse: null,
        cachedAt,
        size: processed.blob.size,
        digest,
      });
      if (!stored) return false;
      const stamped = window.collectionsStore.setArtwork(
        collectionId,
        slotId,
        true,
        cachedAt,
        digest
      );
      if (!stamped.ok) {
        if (previousRecord) await window.imageCache.importPatternImageRecord(previousRecord);
        else await window.imageCache.deletePatternImage(id);
        return false;
      }
      return true;
    } catch (error) {
      console.error("[collections] Failed to store collection image:", error);
      return false;
    }
  };

  /**
   * Object URL for a stored collection image. The CALLER owns the URL and must revoke it.
   * @param {string} collectionId - Collection id
   * @param {string} [slotId] - Slot id; omit for the cover
   * @returns {Promise<string|null>} blob: URL, or null when there is no image
   */
  const getImageUrl = async (collectionId, slotId) => {
    if (!window.imageCache || !window.imageCache.isAvailable()) return null;
    try {
      const id = imageId(collectionId, slotId);
      const record = await window.imageCache.getPatternImage(id);
      if (!record || !record.obverse) return null;
      if (
        !window.collectionsCore.isCurrentArtwork(
          window.collectionsStore.getState(),
          id,
          record.cachedAt,
          record.digest
        )
      ) {
        await window.imageCache.deletePatternImage(id);
        return null;
      }
      return URL.createObjectURL(record.obverse);
    } catch (error) {
      console.warn("[collections] Failed to read collection image:", error);
      return null;
    }
  };

  /** Returns the selected title side, falling back to the other side when needed. */
  const getTitleImage = async (collectionId, side) => {
    const requested = side === "reverse" ? "reverse" : "obverse";
    const first = await getImageUrl(
      collectionId,
      requested === "reverse" ? "title:reverse" : undefined
    );
    if (first) return { url: first, side: requested };
    const fallback = await getImageUrl(
      collectionId,
      requested === "reverse" ? undefined : "title:reverse"
    );
    return fallback
      ? { url: fallback, side: requested === "reverse" ? "obverse" : "reverse" }
      : null;
  };

  /**
   * Deletes a stored collection image.
   * @param {string} collectionId - Collection id
   * @param {string} [slotId] - Slot id; omit for the cover
   * @returns {Promise<boolean>} Whether removal was recorded
   */
  const deleteImage = async (collectionId, slotId) => {
    if (!window.imageCache || !window.imageCache.isAvailable()) return false;
    try {
      const stamped = window.collectionsStore.setArtwork(collectionId, slotId, false);
      if (!stamped.ok) return false;
      const removed = await window.imageCache.deletePatternImage(imageId(collectionId, slotId));
      if (removed && typeof scheduleSyncPush === "function") scheduleSyncPush();
      if (!removed) return false;
      return true;
    } catch (error) {
      console.warn("[collections] Failed to delete collection image:", error);
      return false;
    }
  };

  /** Removes IndexedDB blobs once a Collection tombstone has been saved. */
  const cleanupCollectionImages = async (collectionId, slotIds) => {
    if (!window.imageCache || !window.imageCache.isAvailable()) return;
    const ids = [imageId(collectionId), imageId(collectionId, "title:reverse")].concat(
      (slotIds || []).map((slotId) => imageId(collectionId, slotId))
    );
    await Promise.all(ids.map((id) => window.imageCache.deletePatternImage(id)));
    if (typeof scheduleSyncPush === "function") scheduleSyncPush();
  };

  // ---------------------------------------------------------------------------
  // Builder
  // ---------------------------------------------------------------------------

  /** Weight units that are Goldback / Silverback / Constitutional denominations. */
  const DENOMINATION_UNITS = ["gb", "sb", "cu"];

  /**
   * A labelled form field wrapper.
   * @param {string} labelText - Label
   * @param {HTMLElement} control - Input/select element
   * @param {string} [className] - Extra wrapper class
   * @returns {HTMLElement} Field wrapper
   */
  const field = (labelText, control) => {
    const wrap = el("div");
    const label = el("label", "", labelText);
    const id = `collectionsField${Math.random().toString(36).slice(2, 9)}`;
    control.id = id;
    label.htmlFor = id;
    wrap.append(label, control);
    return wrap;
  };

  /** Static icon markup for the builder: section headers, shape glyphs and the Slot grip. */
  const BUILDER_ICONS = Object.freeze({
    identity:
      '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    content:
      '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 7a4 4 0 0 0 6 0z"/><path d="M19 7l-3 7a4 4 0 0 0 6 0z"/>',
    specs:
      '<circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="21" y2="12"/>',
    display:
      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    about:
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    grip: '<circle cx="8" cy="5" r="1"/><circle cx="16" cy="5" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/>',
    round: '<circle cx="12" cy="12" r="9"/>',
    bar: '<rect x="7" y="2.5" width="10" height="19" rx="1.5"/>',
    note: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/>',
    slab: '<rect x="4.5" y="2.5" width="15" height="19" rx="3"/><circle cx="12" cy="13.5" r="4"/>',
  });

  /**
   * A decorative 16px line icon from BUILDER_ICONS.
   * @param {string} name - BUILDER_ICONS key
   * @param {string} [className] - Wrapper class
   * @returns {HTMLSpanElement} Icon wrapper
   */
  const builderIcon = (name, className) => {
    const wrap = el("span", className || "collections-builder-icon");
    wrap.setAttribute("aria-hidden", "true");
    // Static developer markup only — BUILDER_ICONS is a frozen literal, never user text.
    // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
    wrap.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${BUILDER_ICONS[name] || ""}</svg>`;
    return wrap;
  };

  /**
   * A collapsed-by-default form section using the Add Item modal's details.form-section
   * chrome. It deliberately carries no data-section attribute: that is the Add Item form's
   * persistence hook (js/form-sections.js), and builder sections remember nothing.
   * @param {string} key - BUILDER_ICONS key, also the section's data-builder-section
   * @param {string} title - Header text
   * @param {...HTMLElement} children - Section body content
   * @returns {HTMLDetailsElement} The section; `_refreshCount()` updates its filled-field badge
   */
  const builderSection = (key, title, ...children) => {
    const node = el("details", "form-section");
    node.dataset.builderSection = key;
    const summary = el("summary", "form-section-header");
    const count = el("span", "form-section-count");
    count.hidden = true;
    summary.append(builderIcon(key, "form-section-icon"), title, count);
    const body = el("div", "form-section-body");
    body.append(...children);
    node.append(summary, body);
    node._refreshCount = () => {
      const filled = Array.from(
        body.querySelectorAll("input:not([type=radio]):not([type=file]), textarea")
      ).filter((control) => control.value.trim()).length;
      count.hidden = filled === 0;
      count.textContent = String(filled);
    };
    node.addEventListener("input", node._refreshCount);
    return node;
  };

  /**
   * A labelled segmented control backed by radio inputs, for small either/or choices.
   * @param {string} labelText - Group label
   * @param {{value: string, label: string, glyph?: string}[]} options - Choices, in display
   *   order; glyph is a BUILDER_ICONS key drawn before the label
   * @param {string} value - Initially selected value
   * @param {(value: string) => void} [onChange] - Called when the user picks an option
   * @returns {{node: HTMLElement, getValue: () => string, setValue: (value: string) => void}} Control
   */
  const segmented = (labelText, options, value, onChange) => {
    const wrap = el("div", "collections-builder-choice");
    const caption = el("span", "collections-builder-caption", labelText);
    caption.id = `collectionsSeg${Math.random().toString(36).slice(2, 9)}`;
    const group = el("div", "collections-segmented");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", caption.id);
    const inputs = options.map((option) => {
      const choice = el("label", "collections-segmented-option");
      const input = el("input");
      input.type = "radio";
      input.name = caption.id;
      input.value = option.value;
      input.checked = option.value === value;
      if (onChange) input.addEventListener("change", () => onChange(option.value));
      const face = el("span");
      if (option.glyph) face.appendChild(builderIcon(option.glyph));
      face.append(option.label);
      choice.append(input, face);
      group.appendChild(choice);
      return input;
    });
    wrap.append(caption, group);
    return {
      node: wrap,
      getValue: () => (inputs.find((input) => input.checked) || inputs[0]).value,
      setValue: (next) =>
        inputs.forEach((input) => {
          input.checked = input.value === next;
        }),
    };
  };

  /**
   * An image chooser: a preview medallion plus a hidden file input. Holds the chosen
   * File until the collection is saved (its id does not exist before then).
   * @param {string} label - Accessible label
   * @returns {{node: HTMLElement, getFile: () => File|null, setPreview: (url: string|null) => void}} Chooser
   */
  const imageChooser = (label) => {
    let chosen = null;
    let previewUrl = null;
    let removed = false;
    let hadStoredImage = false;
    let disposed = false;
    // The file input is a SIBLING of the button, never a child: a nested input's click would
    // bubble back into the button's handler, and swapping the preview would detach it.
    const input = el("input");
    input.type = "file";
    input.accept = "image/*";
    input.hidden = true;
    const trigger = button("collections-image-pick", "+", () => input.click());
    trigger.setAttribute("aria-label", label);
    trigger.title = label;
    const node = el("span", "collections-image-chooser");
    const remove = button("collections-image-remove", "×", () => {
      chosen = null;
      removed = true;
      input.value = "";
      setPreview(null);
    });
    remove.setAttribute("aria-label", `Remove ${label.toLowerCase()}`);
    remove.title = `Remove ${label.toLowerCase()}`;
    remove.hidden = true;
    node.append(trigger, remove, input);
    const setPreview = (url) => {
      if (disposed) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (previewUrl && previewUrl !== url) URL.revokeObjectURL(previewUrl);
      previewUrl = url;
      trigger.replaceChildren();
      remove.hidden = !url;
      if (!url) {
        trigger.textContent = "+";
        return;
      }
      const img = el("img");
      img.alt = "";
      img.src = url;
      trigger.appendChild(img);
    };
    input.addEventListener("change", () => {
      if (disposed) return;
      chosen = input.files && input.files[0] ? input.files[0] : null;
      removed = false;
      if (chosen) setPreview(URL.createObjectURL(chosen));
    });
    return {
      node,
      getFile: () => chosen,
      isRemoved: () => removed && hadStoredImage,
      setPreview: (url) => {
        if (url) hadStoredImage = true;
        setPreview(url);
      },
      dispose: () => {
        disposed = true;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      },
    };
  };

  let mintageErrorId = 0;

  /**
   * One editable slot row in the builder.
   * @param {{id?: string, label?: string, year?: string|number, note?: string}} slot - Slot values
   * @param {Function} onRemove - Called with the row element to remove it
   * @param {Function} onMove - Moves the row and restores focus to its control
   * @param {Function} onInsert - Inserts a blank row after this row
   * @param {Function} onLabelChange - Refreshes accessible names after label edits
   * @param {Function} wireDrag - Wires pointer dragging onto the row's handle
   * @returns {HTMLElement} Row element (carries its slot id in dataset.slotId when carried over)
   */
  const builderRow = (slot, onRemove, onMove, onInsert, onLabelChange, wireDrag) => {
    const row = el("div", "collections-builder-row");
    if (slot.id) row.dataset.slotId = slot.id;
    // STRK-421: one handle per Slot card. Drag it, or focus it and press Arrow Up / Down.
    const grip = el("button", "collections-builder-grip");
    grip.type = "button";
    grip.dataset.action = "grip";
    grip.appendChild(builderIcon("grip"));
    grip.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      onMove(row, event.key === "ArrowUp" ? -1 : 1, grip);
    });
    wireDrag(grip, row);
    const chooser = imageChooser("Slot image");
    row._chooser = chooser;
    const label = el("input", "collections-builder-label");
    label.type = "text";
    label.placeholder = "Slot label — e.g. 1881-CC";
    label.value = slot.label || "";
    label.setAttribute("aria-label", "Slot label");
    const year = el("input", "collections-builder-year");
    year.type = "text";
    year.inputMode = "numeric";
    year.placeholder = "Year";
    year.value = slot.year == null ? "" : String(slot.year);
    year.setAttribute("aria-label", "Year");
    const mintage = el("input", "collections-builder-mintage");
    mintage.type = "text";
    mintage.inputMode = "numeric";
    mintage.placeholder = "Mintage (optional)";
    mintage.value =
      Number.isSafeInteger(slot.mintage) && slot.mintage >= 0 ? String(slot.mintage) : "";
    mintage.setAttribute("aria-label", "Mintage");
    const error = el("span", "collections-builder-mintage-error");
    error.id = `collections-mintage-error-${++mintageErrorId}`;
    error.hidden = true;
    error.setAttribute("role", "alert");
    mintage.setAttribute("aria-describedby", error.id);
    mintage.addEventListener("input", () => {
      mintage.removeAttribute("aria-invalid");
      error.hidden = true;
      error.textContent = "";
    });
    const note = el("input", "collections-builder-note");
    note.type = "text";
    note.placeholder = "Note (optional)";
    note.value = slot.note || "";
    note.setAttribute("aria-label", "Note");
    const remove = button("collections-builder-remove", "×", () => onRemove(row));
    remove.setAttribute("aria-label", "Remove slot");
    const actions = el("div", "collections-builder-row-actions");
    const insert = button("collections-builder-insert", "+", () => onInsert(row));
    insert.dataset.action = "insert";
    remove.dataset.action = "remove";
    actions.append(insert, remove);
    label.addEventListener("input", onLabelChange);
    row.append(grip, chooser.node, label, year, mintage, note, actions, error);
    return row;
  };

  /**
   * Parses "1986-2005" (or a single year) into an ascending list of years.
   * @param {string} input - User input
   * @returns {number[]|null} Years, or null when the input is not a sane range
   */
  const parseYearRange = (input) => {
    const found = /^\s*(\d{4})\s*(?:[-–—]|to)?\s*(\d{4})?\s*$/i.exec(String(input || ""));
    if (!found) return null;
    const start = Number(found[1]);
    const end = found[2] ? Number(found[2]) : start;
    if (end < start || end - start >= MAX_YEAR_RANGE) return null;
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  };

  /**
   * Starting values for the builder: an existing custom collection, a clone of a
   * template (or of a custom collection), or a blank three-slot checklist.
   * @param {{cloneFrom?: string, editId?: string}} request - Builder request
   * @returns {{name: string, metal: string, description: string, side: string, showItemImages: boolean,
   *   slots: Object[], clonedFrom: string|null, editId: string|null}} Seed values
   */
  const builderSeed = (request) => {
    const blank = {
      name: "",
      metal: "Silver",
      variant: "",
      subtitle: "",
      issuer: "",
      weight: "",
      weightUnit: "oz",
      itemType: "Coin",
      purity: 0.9999,
      specs: {},
      imageShape: "round",
      about: "",
      description: "",
      side: "obverse",
      showItemImages: true,
      slots: [{}, {}, {}],
      clonedFrom: null,
      editId: null,
    };
    const sourceId = request.editId || request.cloneFrom;
    if (!sourceId) return blank;
    const context = contextFor(sourceId);
    if (!context.collection && !context.template) return blank;
    const definition = (context.collection && context.collection.definition) || {};
    const itemType =
      definition.itemType ||
      (context.template && (context.template.itemType || context.template.type)) ||
      "Coin";
    const slots = context.slots.map((slot) => ({
      // Ids carry over only when EDITING; a clone is a new collection and mints its own.
      id: request.editId ? slot.id : undefined,
      label: `${slot.label || slot.year || ""}${slot.tag ? ` ${slot.tag}` : ""}`.trim(),
      year: slot.year,
      mintage: slot.mintage,
      note: request.editId ? slot.note : "",
    }));
    return {
      name: request.editId ? context.title : `${context.title} — my set`,
      metal: definition.metal || (context.template && context.template.metal) || "Silver",
      variant: definition.variant || (context.template && context.template.variant) || "",
      subtitle: definition.subtitle || (context.template && context.template.subtitle) || "",
      issuer: definition.issuer || (context.template && context.template.issuer) || "",
      weight: definition.weight ?? (context.template && context.template.weight) ?? "",
      weightUnit:
        definition.weightUnit || (context.template && context.template.weightUnit) || "oz",
      itemType,
      // An edit never invents a purity the Collection did not have; only a new one defaults.
      purity:
        definition.purity ??
        (context.template && context.template.purity) ??
        (request.editId ? null : 0.9999),
      specs: definition.specs || (context.template && context.template.specs) || {},
      imageShape:
        definition.imageShape || window.collectionsCore.defaultImageShapeForType(itemType),
      about:
        definition.about ||
        definition.description ||
        (context.template && context.template.about) ||
        "",
      description: definition.about || definition.description || "",
      side: definition.side === "reverse" ? "reverse" : "obverse",
      showItemImages: definition.showItemImages !== false,
      slots,
      clonedFrom: request.editId ? null : sourceId,
      editId: request.editId || null,
    };
  };

  /**
   * Stores any images chosen in the builder once the collection id is known.
   * @param {string} collectionId - Saved collection id
   * @param {{getFile: Function}} cover - Cover chooser
   * @param {HTMLElement[]} rows - Builder rows, in the same order as the saved definition
   * @returns {Promise<void>}
   */
  const persistChosenImages = async (collectionId, cover, reverseTitle, rows, removedSlotIds) => {
    const collection = window.collectionsStore.getState().collections[collectionId];
    const slots = (collection && collection.definition && collection.definition.slots) || [];
    const jobs = [];
    if (cover.getFile()) jobs.push(saveImage(collectionId, null, cover.getFile()));
    else if (cover.isRemoved()) jobs.push(deleteImage(collectionId, null));
    if (reverseTitle.getFile())
      jobs.push(saveImage(collectionId, "title:reverse", reverseTitle.getFile()));
    else if (reverseTitle.isRemoved()) jobs.push(deleteImage(collectionId, "title:reverse"));
    rows.forEach((row, index) => {
      const file = row._chooser.getFile();
      if (file && slots[index]) jobs.push(saveImage(collectionId, slots[index].id, file));
      else if (row._chooser.isRemoved() && slots[index]) {
        jobs.push(deleteImage(collectionId, slots[index].id));
      }
    });
    (removedSlotIds || []).forEach((slotId) => jobs.push(deleteImage(collectionId, slotId)));
    if (!jobs.length) return;
    const stored = await Promise.all(jobs);
    if (stored.includes(false)) toast("Some collection image changes could not be saved.");
    document.dispatchEvent(new CustomEvent(window.collectionsStore.CHANGED_EVENT));
  };

  /**
   * Opens the custom collection builder.
   * @param {{cloneFrom?: string, editId?: string}} [request] - cloneFrom: a template slug or collection id to
   *   copy; editId: a custom collection to edit
   * @returns {void}
   */
  const openBuilder = (request) => {
    const store = window.collectionsStore;
    const seed = builderSeed(request || {});
    const chooserDisposers = [];
    const shell = ensureModal(BUILDER_MODAL_ID, "collections-modal-content--builder");
    shell.title.textContent = seed.editId
      ? "Edit collection"
      : seed.clonedFrom
        ? "Clone & customize"
        : "New collection";
    // STRK-421: the builder mirrors the Add Item modal, whose header is the title alone.
    shell.subtitle.textContent = "";
    shell.subtitle.hidden = true;

    const name = el("input");
    name.type = "text";
    name.placeholder = "e.g. Goldback state set";
    name.value = seed.name;
    const nameError = el("div", "collections-builder-error", "Give the collection a name.");
    nameError.id = "collectionsBuilderNameError";
    nameError.hidden = true;
    nameError.setAttribute("role", "alert");
    name.setAttribute("aria-describedby", nameError.id);
    name.addEventListener("input", () => {
      name.removeAttribute("aria-invalid");
      nameError.hidden = true;
    });
    const metal = el("select");
    METALS.forEach((option) => metal.appendChild(el("option", "", option)));
    metal.value = METALS.includes(seed.metal) ? seed.metal : "Mixed";
    const side = segmented(
      "Coin side",
      [
        { value: "obverse", label: "Obverse" },
        { value: "reverse", label: "Reverse" },
      ],
      seed.side
    );
    // STRK-401: Hide makes filled Slots show collection artwork instead of Item photos.
    const itemImages = segmented(
      "Item images",
      [
        { value: "show", label: "Show" },
        { value: "hide", label: "Hide" },
      ],
      seed.showItemImages ? "show" : "hide"
    );
    const description = el("input");
    description.type = "text";
    description.placeholder = "Notes about this set (optional)";
    description.value = seed.description;

    const variant = el("input");
    variant.value = seed.variant;
    const subtitle = el("input");
    subtitle.value = seed.subtitle;
    const issuer = el("input");
    issuer.value = seed.issuer;
    const weight = el("input");
    weight.type = "number";
    weight.min = "0";
    weight.step = "any";
    weight.value = seed.weight;
    const weightUnit = el("select");
    [
      ["oz", "oz"],
      ["g", "g"],
      ["mg", "mg"],
      ["kg", "kg"],
      ["lb", "lb"],
      ["avdp", "avoirdupois oz"],
      ["gb", "goldback"],
      ["sb", "silverback"],
      ["cu", "constitutional"],
    ].forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = value;
      weightUnit.appendChild(option);
    });
    weightUnit.value = seed.weightUnit;
    const itemType = el("select");
    Array.from(elements.itemType instanceof HTMLSelectElement ? elements.itemType.options : [])
      .filter((option) => option.value)
      .forEach((option) => itemType.appendChild(option.cloneNode(true)));
    itemType.value = seed.itemType;
    const puritySelect =
      elements.itemPuritySelect instanceof HTMLSelectElement
        ? elements.itemPuritySelect.cloneNode(true)
        : el("select");
    // Legacy and Mixed-metal Collections have no purity; "Not set" keeps that true on save.
    const unsetPurity = el("option", "", "Not set");
    unsetPurity.value = "";
    puritySelect.insertBefore(unsetPurity, puritySelect.firstChild);
    const purityCustom = el("input");
    purityCustom.type = "number";
    purityCustom.min = "0.001";
    purityCustom.max = "1";
    purityCustom.step = "any";
    purityCustom.value = String(seed.purity ?? "");
    const purityCustomField = field("Custom purity", purityCustom);
    const updatePurity = () => {
      purityCustomField.hidden = puritySelect.value !== "custom";
    };
    puritySelect.value =
      seed.purity == null
        ? ""
        : Array.from(puritySelect.options).some(
              (option) => option.value !== "" && Number(option.value) === Number(seed.purity)
            )
          ? String(seed.purity)
          : "custom";
    if (puritySelect.value === "custom") purityCustom.value = String(seed.purity ?? "");
    puritySelect.addEventListener("change", updatePurity);
    updatePurity();
    const purityCaption = el("span", "collections-builder-hint");
    const updatePurityCaption = () => {
      const value =
        puritySelect.value === "custom" ? Number(purityCustom.value) : Number(puritySelect.value);
      const metalName = metal.value.toLowerCase();
      purityCaption.textContent =
        puritySelect.value !== "" && Number.isFinite(value)
          ? `${value >= 1 ? "pure" : `.${String(value).split(".")[1] || ""}`} fine ${metalName}`
          : "Fineness is shown from purity and metal.";
    };
    puritySelect.addEventListener("change", updatePurityCaption);
    purityCustom.addEventListener("input", updatePurityCaption);
    metal.addEventListener("change", updatePurityCaption);
    updatePurityCaption();
    const diameter = el("input");
    diameter.type = "number";
    diameter.min = "0";
    diameter.step = "any";
    diameter.value = seed.specs.diameterMm || "";
    diameter.placeholder = "mm";
    const grossWeightGrams = el("input");
    grossWeightGrams.type = "number";
    grossWeightGrams.min = "0";
    grossWeightGrams.step = "any";
    grossWeightGrams.value = seed.specs.grossWeightGrams || "";
    const thickness = el("input");
    thickness.type = "number";
    thickness.min = "0";
    thickness.step = "any";
    thickness.value = seed.specs.thicknessMm || "";
    thickness.placeholder = "mm";
    const faceValue = el("input");
    faceValue.value = seed.specs.faceValue || "";
    const composition = el("input");
    composition.value = seed.specs.composition || "";
    const edge = el("input");
    edge.value = seed.specs.edge || "";
    const mintMark = el("input");
    mintMark.value = seed.specs.mintMark || "";
    const authorization = el("input");
    authorization.value = seed.specs.authorization || "";
    const dimensions = el("input");
    dimensions.value = seed.specs.dimensions || "";
    // The title images take the chosen outline live, so the picker previews its own effect.
    const covers = el("div", "collections-builder-covers");
    covers.dataset.shape = seed.imageShape;
    const imageShape = segmented(
      "Image shape",
      [
        { value: "round", label: "Round", glyph: "round" },
        { value: "bar", label: "Bar", glyph: "bar" },
        { value: "note", label: "Note", glyph: "note" },
        { value: "slab", label: "Slab", glyph: "slab" },
      ],
      seed.imageShape,
      (value) => {
        imageShapeTouched = true;
        covers.dataset.shape = value;
      }
    );
    const lockPill = el("span", "lock-pill", "auto");
    lockPill.hidden = true;
    let imageShapeTouched =
      seed.imageShape !==
      (seed.itemType === "Bar" || seed.itemType === "Set"
        ? "bar"
        : ["Note", "Aurum", "Goldback", "Silverback"].includes(seed.itemType)
          ? "note"
          : "round");
    const suggestedShape = (type) =>
      type === "Bar" || type === "Set"
        ? "bar"
        : ["Note", "Aurum", "Goldback", "Silverback"].includes(type)
          ? "note"
          : "round";
    /**
     * Shows a forced Metal and Weight unit as locked, like the Add Item form's "auto" pill.
     * The save path re-applies the lock as well, so a stale value can never be stored.
     * @returns {void}
     */
    const applyTypeLock = () => {
      const lock = window.collectionsCore.typeLockFor(itemType.value);
      if (lock) {
        metal.value = lock.metal;
        weightUnit.value = lock.weightUnit;
        metal.dispatchEvent(new Event("change"));
      } else if (DENOMINATION_UNITS.includes(weightUnit.value)) {
        // Like handleTypeChange: leaving a denomination type drops its gb/sb/cu unit.
        weightUnit.value = "oz";
      }
      metal.disabled = Boolean(lock);
      weightUnit.disabled = Boolean(lock);
      lockPill.hidden = !lock;
    };
    itemType.addEventListener("change", () => {
      if (!imageShapeTouched) {
        imageShape.setValue(suggestedShape(itemType.value));
        covers.dataset.shape = imageShape.getValue();
      }
      applyTypeLock();
    });
    const about = el("textarea");
    about.value = seed.about;
    about.rows = 3;

    const cover = imageChooser("Cover image");
    const reverseTitle = imageChooser("Reverse title image");
    chooserDisposers.push(cover.dispose, reverseTitle.dispose);
    const obverseTitleWrap = el("div", "collections-builder-title-option");
    obverseTitleWrap.append(
      el("span", "collections-builder-caption", "Obverse title image"),
      cover.node
    );
    const reverseTitleWrap = el("div", "collections-builder-title-option");
    reverseTitleWrap.append(
      el("span", "collections-builder-caption", "Reverse title image"),
      reverseTitle.node
    );
    covers.append(obverseTitleWrap, reverseTitleWrap);
    // STRK-421 hero: large centred title images with the Image shape picker beneath them.
    const hero = el("div", "collections-builder-hero");
    hero.appendChild(covers);
    if (!imagesAvailable()) {
      hero.appendChild(
        el("span", "collections-builder-hint", "Images are unavailable in this browser session.")
      );
    }
    hero.appendChild(imageShape.node);
    if (seed.editId) {
      getImageUrl(seed.editId).then((url) => url && cover.setPreview(url));
      getImageUrl(seed.editId, "title:reverse").then((url) => url && reverseTitle.setPreview(url));
    }
    const rowsHost = el("div", "collections-builder-rows");
    const slotCount = el("span", "form-section-count");
    const orderStatus = el("div", "sr-only");
    orderStatus.setAttribute("role", "status");
    const refreshRowActions = () => {
      Array.from(rowsHost.children).forEach((row, index) => {
        const label =
          row.querySelector(".collections-builder-label").value.trim() || `Slot ${index + 1}`;
        const names = {
          grip: `Reorder ${label}`,
          insert: `Add Slot after ${label}`,
          remove: `Remove Slot ${label}`,
        };
        row.querySelectorAll("[data-action]").forEach((control) => {
          control.setAttribute("aria-label", names[control.dataset.action]);
          control.title =
            control.dataset.action === "grip"
              ? "Drag to reorder, or press Arrow Up or Arrow Down"
              : names[control.dataset.action];
        });
      });
      slotCount.textContent = String(rowsHost.children.length);
    };
    const announceMove = (row) => {
      const position = Array.from(rowsHost.children).indexOf(row) + 1;
      const label = row.querySelector(".collections-builder-label").value.trim() || "Slot";
      orderStatus.textContent = `${label} moved to position ${position} of ${rowsHost.children.length}.`;
    };
    let dragRowId = 0;
    /**
     * Pointer dragging for a Slot card's handle, through the same helper the Settings
     * My order list uses, so every reorderable list in Collections drags the same way.
     * @param {HTMLButtonElement} grip - The card's handle
     * @param {HTMLElement} row - The Slot card
     * @returns {void}
     */
    const wireDrag = (grip, row) => {
      row.dataset.dragId = String(++dragRowId);
      const ui = window.collectionsUI;
      if (!ui || typeof ui.wireReorderHandle !== "function") return;
      // A long Slot list scrolls inside the modal: nudge it while a drag nears an edge,
      // so a card can be carried past the visible rows.
      grip.addEventListener("pointermove", (event) => {
        if (!row.classList.contains("is-dragging")) return;
        const bounds = shell.body.getBoundingClientRect();
        if (event.clientY < bounds.top + 36) shell.body.scrollTop -= 12;
        else if (event.clientY > bounds.bottom - 36) shell.body.scrollTop += 12;
      });
      ui.wireReorderHandle(grip, {
        id: row.dataset.dragId,
        itemSelector: `#${BUILDER_MODAL_ID} .collections-builder-row`,
        idOf: (node) => node.dataset.dragId,
        onDrop: (targetId, after) => {
          const target = Array.from(rowsHost.children).find(
            (node) => node.dataset.dragId === targetId
          );
          if (!target) return;
          rowsHost.insertBefore(row, after ? target.nextElementSibling : target);
          refreshRowActions();
          grip.focus();
          announceMove(row);
        },
      });
    };
    const removeRow = (row) => {
      if (rowsHost.children.length > 1) {
        const next = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        refreshRowActions();
        next.querySelector(".collections-builder-label").focus();
      } else toast("A collection needs at least one slot.");
    };
    const moveRow = (row, direction, control) => {
      const adjacent = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
      if (!adjacent) return;
      rowsHost.insertBefore(row, direction < 0 ? adjacent : adjacent.nextElementSibling);
      refreshRowActions();
      control.focus();
      announceMove(row);
    };
    const insertRow = (after) => {
      const row = addRow({}, after);
      row.querySelector(".collections-builder-label").focus();
      orderStatus.textContent = "Blank Slot inserted.";
    };
    const addRow = (slot, after) => {
      const row = builderRow(
        slot || {},
        removeRow,
        moveRow,
        insertRow,
        refreshRowActions,
        wireDrag
      );
      chooserDisposers.push(row._chooser.dispose);
      rowsHost.insertBefore(row, after ? after.nextElementSibling : null);
      refreshRowActions();
      if (seed.editId && slot && slot.id) {
        getImageUrl(seed.editId, slot.id).then((url) => url && row._chooser.setPreview(url));
      }
      return row;
    };
    seed.slots.forEach((slot) => addRow(slot));

    // STRK-421 layout (approved playground variant C): Type | Metal, the name, the title
    // images with the shape picker, the Slot cards, then every optional field collapsed.
    const form = el("div", "collections-builder-form");
    const grid = (className, ...children) => {
      const node = el("div", `grid ${className}`);
      node.append(...children);
      return node;
    };
    const metalField = field("Metal", metal);
    metalField.querySelector("label").append(" ", lockPill);
    const nameField = field("Collection name", name);
    nameField.appendChild(nameError);
    const sections = [
      builderSection(
        "identity",
        "Identity",
        grid("grid-2", field("Variant", variant), field("Issuer", issuer)),
        field("Subtitle", subtitle)
      ),
      builderSection(
        "content",
        "Metal content",
        grid(
          "collections-builder-grid-3",
          field("Weight", weight),
          field("Weight unit", weightUnit),
          field("Purity", puritySelect),
          purityCustomField
        ),
        purityCaption
      ),
      builderSection(
        "specs",
        "Specifications",
        grid(
          "collections-builder-grid-3",
          field("Diameter", diameter),
          field("Gross weight (g)", grossWeightGrams),
          field("Thickness", thickness),
          field("Face value", faceValue),
          field("Composition", composition),
          field("Edge", edge),
          field("Mint mark", mintMark),
          field("Authorization", authorization),
          field("Dimensions", dimensions)
        )
      ),
      builderSection("display", "Display", grid("grid-2", side.node, itemImages.node)),
      builderSection("about", "About", field("About this collection", about)),
    ];
    sections.forEach((section) => section._refreshCount());
    /**
     * Opens the collapsed section holding a control, so a validation message never
     * points at a field the user cannot see.
     * @param {HTMLElement} control - The invalid control
     * @returns {void}
     */
    const reveal = (control) => {
      const section = control.closest("details.form-section");
      if (section) section.open = true;
      control.focus();
    };
    const slotsHeading = el("div", "collections-builder-slots-head");
    slotsHeading.append(el("span", "collections-builder-caption", "Slots"), slotCount);
    const rowActions = el("div", "collections-builder-actions");
    rowActions.append(
      button("btn secondary", "+ Add slot", () =>
        addRow({}).querySelector(".collections-builder-label").focus()
      ),
      button("btn secondary", "+ Add year range…", async () => {
        const answer = await showAppPrompt(
          "Enter a year range, e.g. 1986-2005",
          "",
          "Add year range"
        );
        if (answer == null) return;
        const years = parseYearRange(answer);
        if (!years) {
          toast("Enter a range like 1986-2005.");
          return;
        }
        years.forEach((year) => addRow({ label: String(year), year }));
      })
    );
    form.append(
      grid("grid-2", field("Type", itemType), metalField),
      nameField,
      hero,
      slotsHeading,
      rowsHost,
      rowActions,
      el("div", "collections-builder-divider collections-builder-caption", "Optional details"),
      ...sections
    );
    shell.body.replaceChildren(form, orderStatus);
    // A reopened builder starts at the top; the modal element is reused between opens.
    shell.body.scrollTop = 0;
    applyTypeLock();

    const modalObserver = new MutationObserver(() => {
      if (shell.modal.style.display === "none") {
        chooserDisposers.forEach((dispose) => dispose());
        modalObserver.disconnect();
      }
    });
    modalObserver.observe(shell.modal, { attributes: true, attributeFilter: ["style"] });

    const submit = async () => {
      const purityValue =
        puritySelect.value === ""
          ? null
          : puritySelect.value === "custom"
            ? Number(purityCustom.value)
            : Number(puritySelect.value);
      const weightValue = weight.value === "" ? null : Number(weight.value);
      if (
        purityValue != null &&
        (!Number.isFinite(purityValue) || purityValue <= 0 || purityValue > 1)
      ) {
        purityCustom.setAttribute("aria-invalid", "true");
        reveal(purityCustom);
        toast("Enter a purity greater than 0 and no greater than 1.");
        return;
      }
      purityCustom.removeAttribute("aria-invalid");
      if (weightValue != null && (!Number.isFinite(weightValue) || weightValue < 0)) {
        weight.setAttribute("aria-invalid", "true");
        reveal(weight);
        toast("Weight must be a non-negative number.");
        return;
      }
      weight.removeAttribute("aria-invalid");
      const rows = Array.from(rowsHost.children).filter((row) =>
        row.querySelector(".collections-builder-label").value.trim()
      );
      let firstInvalid = null;
      const counts = new Map();
      Array.from(rowsHost.children).forEach((row) => {
        const input = row.querySelector(".collections-builder-mintage");
        const raw = input.value.trim();
        const value = raw === "" ? undefined : Number(raw);
        const valid = raw === "" || (/^\d+$/.test(raw) && Number.isSafeInteger(value));
        const error = row.querySelector(".collections-builder-mintage-error");
        input.setAttribute("aria-invalid", String(!valid));
        error.hidden = valid;
        error.textContent = valid
          ? ""
          : "Mintage must be a whole number from 0 to 9,007,199,254,740,991.";
        if (!valid && !firstInvalid) firstInvalid = input;
        counts.set(row, value);
      });
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }
      // Metal and unit stay editable after a type is chosen, so re-apply the lock here.
      const lock = window.collectionsCore.typeLockFor(itemType.value);
      const savedUnit =
        lock || !DENOMINATION_UNITS.includes(weightUnit.value) ? weightUnit.value : "oz";
      const spec = {
        name: name.value,
        metal: lock ? lock.metal : metal.value,
        variant: variant.value,
        subtitle: subtitle.value,
        issuer: issuer.value,
        weight: weightValue,
        weightUnit: lock ? lock.weightUnit : savedUnit,
        itemType: itemType.value,
        purity: purityValue,
        specs: {
          diameterMm: diameter.value === "" ? "" : Number(diameter.value),
          grossWeightGrams: grossWeightGrams.value === "" ? "" : Number(grossWeightGrams.value),
          thicknessMm: thickness.value === "" ? "" : Number(thickness.value),
          faceValue: faceValue.value,
          composition: composition.value,
          edge: edge.value,
          mintMark: mintMark.value,
          authorization: authorization.value,
          dimensions: dimensions.value,
        },
        imageShape: imageShape.getValue(),
        about: about.value,
        side: side.getValue(),
        showItemImages: itemImages.getValue() === "show",
        description: about.value,
        clonedFrom: seed.clonedFrom,
        slots: rows.map((row) => ({
          id: row.dataset.slotId,
          label: row.querySelector(".collections-builder-label").value,
          year: row.querySelector(".collections-builder-year").value,
          note: row.querySelector(".collections-builder-note").value,
          ...(counts.get(row) === undefined ? {} : { mintage: counts.get(row) }),
        })),
      };
      const previousSlots = seed.editId ? seed.slots.map((slot) => slot.id).filter(Boolean) : [];
      const result = seed.editId ? store.updateCustom(seed.editId, spec) : store.createCustom(spec);
      if (!result.ok) {
        const reasons = {
          "invalid-name": "Give the collection a name.",
          "no-slots": "Add at least one labelled slot.",
          "invalid-mintage": "Enter a whole, non-negative safe integer for Mintage.",
        };
        if (result.reason === "invalid-name") {
          name.setAttribute("aria-invalid", "true");
          nameError.hidden = false;
          name.focus();
        }
        toast(reasons[result.reason] || "Could not save the collection.");
        return;
      }
      const savedId = seed.editId || result.collection.id;
      const currentSlots = new Set(
        ((store.getState().collections[savedId] || {}).definition || {}).slots?.map(
          (slot) => slot.id
        ) || []
      );
      const removedSlotIds = previousSlots.filter((id) => !currentSlots.has(id));
      closeModalById(BUILDER_MODAL_ID);
      toast(seed.editId ? "Collection updated." : "Collection created.");
      await persistChosenImages(savedId, cover, reverseTitle, rows, removedSlotIds);
      if (
        !seed.editId &&
        window.collectionsUI &&
        typeof window.collectionsUI.openCollection === "function"
      ) {
        window.collectionsUI.openCollection(savedId);
      }
    };

    // Footer mirrors the Add Item action bar: an outlined Cancel and the premium submit.
    const footerActions = el("span", "collections-modal-footer-actions");
    footerActions.append(
      button("btn collections-builder-cancel", "Cancel", () => closeModalById(BUILDER_MODAL_ID)),
      button("btn premium", seed.editId ? "Save changes" : "Create collection", submit)
    );
    shell.footer.classList.add(
      "collections-modal-footer--actions-only",
      "collections-builder-footer"
    );
    shell.footer.replaceChildren(footerActions);
    openModalById(BUILDER_MODAL_ID);
  };

  // ---------------------------------------------------------------------------
  // Global exposure
  // ---------------------------------------------------------------------------
  window.collectionsPicker = Object.freeze({
    openLinkPicker,
    openBuilder,
    parseYearRange,
    getImageUrl,
    getTitleImage,
    saveImage,
    deleteImage,
    cleanupCollectionImages,
  });
})();

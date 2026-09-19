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
        if (event.key === "Escape") closeModalById(id);
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
      item.weight ? `${item.weight} ${item.weightUnit || "oz"}` : "",
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

      const rest = active.filter((item) => !suggestedIds.has(item.uuid) && matches(item));
      const heading = el("div", "collections-pick-group is-muted", "All active items");
      heading.appendChild(
        el("span", "collections-pick-group-note", " · disposed items are never shown")
      );
      list.appendChild(heading);
      rest
        .slice(0, MAX_LISTED_ITEMS)
        .forEach((item) =>
          list.appendChild(pickerRow(item, { usedIn: used.get(item.uuid), onLink }))
        );
      if (!rest.length) list.appendChild(el("p", "collections-pick-note", "No items match."));
      if (rest.length > MAX_LISTED_ITEMS) {
        const more = rest.length - MAX_LISTED_ITEMS;
        list.appendChild(
          el("p", "collections-pick-note", `${more} more — refine the search to narrow the list.`)
        );
      }
    };
    search.addEventListener("input", renderList);

    shell.body.replaceChildren(search, list);
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
    slotId ? `collection--${collectionId}--${slotId}` : `collection--${collectionId}`;

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
      return Boolean(
        await window.imageCache.cachePatternImage(
          imageId(collectionId, slotId),
          processed.blob,
          null
        )
      );
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
      return (
        (await window.imageCache.getPatternImageUrl(imageId(collectionId, slotId), "obverse")) ||
        null
      );
    } catch (error) {
      console.warn("[collections] Failed to read collection image:", error);
      return null;
    }
  };

  /**
   * Deletes a stored collection image.
   * @param {string} collectionId - Collection id
   * @param {string} [slotId] - Slot id; omit for the cover
   * @returns {Promise<void>}
   */
  const deleteImage = async (collectionId, slotId) => {
    if (!window.imageCache || !window.imageCache.isAvailable()) return;
    try {
      await window.imageCache.deletePatternImage(imageId(collectionId, slotId));
    } catch (error) {
      console.warn("[collections] Failed to delete collection image:", error);
    }
  };

  // ---------------------------------------------------------------------------
  // Builder
  // ---------------------------------------------------------------------------

  /**
   * A labelled form field wrapper.
   * @param {string} labelText - Label
   * @param {HTMLElement} control - Input/select element
   * @param {string} [className] - Extra wrapper class
   * @returns {HTMLElement} Field wrapper
   */
  const field = (labelText, control, className) => {
    const wrap = el("div", `collections-field ${className || ""}`.trim());
    const label = el("label", "", labelText);
    const id = `collectionsField${Math.random().toString(36).slice(2, 9)}`;
    control.id = id;
    label.htmlFor = id;
    wrap.append(label, control);
    return wrap;
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
    node.append(trigger, input);
    const setPreview = (url) => {
      trigger.replaceChildren();
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
      chosen = input.files && input.files[0] ? input.files[0] : null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = chosen ? URL.createObjectURL(chosen) : null;
      setPreview(previewUrl);
    });
    return { node, getFile: () => chosen, setPreview };
  };

  /**
   * One editable slot row in the builder.
   * @param {{id?: string, label?: string, year?: string|number, note?: string}} slot - Slot values
   * @param {Function} onRemove - Called with the row element to remove it
   * @returns {HTMLElement} Row element (carries its slot id in dataset.slotId when carried over)
   */
  const builderRow = (slot, onRemove) => {
    const row = el("div", "collections-builder-row");
    if (slot.id) row.dataset.slotId = slot.id;
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
    const note = el("input", "collections-builder-note");
    note.type = "text";
    note.placeholder = "Note (optional)";
    note.value = slot.note || "";
    note.setAttribute("aria-label", "Note");
    const remove = button("collections-builder-remove", "×", () => onRemove(row));
    remove.setAttribute("aria-label", "Remove slot");
    row.append(chooser.node, label, year, note, remove);
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
   * @returns {{name: string, metal: string, description: string, slots: Object[], clonedFrom: string|null,
   *   editId: string|null}} Seed values
   */
  const builderSeed = (request) => {
    const blank = {
      name: "",
      metal: "Silver",
      description: "",
      slots: [{}, {}, {}],
      clonedFrom: null,
      editId: null,
    };
    const sourceId = request.editId || request.cloneFrom;
    if (!sourceId) return blank;
    const context = contextFor(sourceId);
    if (!context.collection && !context.template) return blank;
    const definition = (context.collection && context.collection.definition) || {};
    const slots = context.slots.map((slot) => ({
      // Ids carry over only when EDITING; a clone is a new collection and mints its own.
      id: request.editId ? slot.id : undefined,
      label: `${slot.label || slot.year || ""}${slot.tag ? ` ${slot.tag}` : ""}`.trim(),
      year: slot.year,
      note: request.editId ? slot.note : "",
    }));
    return {
      name: request.editId ? context.title : `${context.title} — my set`,
      metal: definition.metal || (context.template && context.template.metal) || "Silver",
      description: definition.description || "",
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
  const persistChosenImages = async (collectionId, cover, rows) => {
    const collection = window.collectionsStore.getState().collections[collectionId];
    const slots = (collection && collection.definition && collection.definition.slots) || [];
    const jobs = [];
    if (cover.getFile()) jobs.push(saveImage(collectionId, null, cover.getFile()));
    rows.forEach((row, index) => {
      const file = row._chooser.getFile();
      if (file && slots[index]) jobs.push(saveImage(collectionId, slots[index].id, file));
    });
    if (!jobs.length) return;
    const stored = await Promise.all(jobs);
    if (stored.includes(false)) toast("Some images could not be stored on this device.");
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
    const shell = ensureModal(BUILDER_MODAL_ID, "collections-modal-content--builder");
    shell.title.textContent = seed.editId
      ? "Edit collection"
      : seed.clonedFrom
        ? "Clone & customize"
        : "New collection";
    shell.subtitle.textContent =
      "Build any checklist — states, mint marks, varieties, a type set. Images stay on this device, like item photos.";

    const name = el("input");
    name.type = "text";
    name.placeholder = "e.g. Goldback state set";
    name.value = seed.name;
    const metal = el("select");
    METALS.forEach((option) => metal.appendChild(el("option", "", option)));
    metal.value = METALS.includes(seed.metal) ? seed.metal : "Mixed";
    const description = el("input");
    description.type = "text";
    description.placeholder = "Notes about this set (optional)";
    description.value = seed.description;

    const cover = imageChooser("Cover image");
    const coverWrap = el("div", "collections-builder-cover");
    coverWrap.append(
      cover.node,
      el(
        "span",
        "collections-builder-hint",
        imagesAvailable()
          ? "Cover image (optional) — resized and compressed like item photos. Each slot can carry its own image too."
          : "Images are unavailable in this browser session."
      )
    );
    if (seed.editId) getImageUrl(seed.editId).then((url) => url && cover.setPreview(url));

    const rowsHost = el("div", "collections-builder-rows");
    const removeRow = (row) => {
      if (rowsHost.children.length > 1) row.remove();
      else toast("A collection needs at least one slot.");
    };
    const addRow = (slot) => {
      const row = builderRow(slot || {}, removeRow);
      rowsHost.appendChild(row);
      if (seed.editId && slot && slot.id) {
        getImageUrl(seed.editId, slot.id).then((url) => url && row._chooser.setPreview(url));
      }
      return row;
    };
    seed.slots.forEach(addRow);

    const form = el("div", "collections-builder-form");
    form.append(
      field("Collection name", name),
      field("Metal", metal),
      field("Description", description, "is-wide"),
      coverWrap
    );
    const slotsHeading = el("div", "collections-pick-group", "Slots");
    slotsHeading.appendChild(
      el("span", "collections-pick-group-note", " · a slot keeps its links when you rename it")
    );
    const rowActions = el("div", "collections-builder-actions");
    rowActions.append(
      button("btn secondary collections-btn-pill", "+ Add slot", () =>
        addRow({}).querySelector(".collections-builder-label").focus()
      ),
      button("btn secondary collections-btn-pill", "+ Add year range…", async () => {
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
    shell.body.replaceChildren(form, slotsHeading, rowsHost, rowActions);

    const submit = async () => {
      const rows = Array.from(rowsHost.children).filter((row) =>
        row.querySelector(".collections-builder-label").value.trim()
      );
      const spec = {
        name: name.value,
        metal: metal.value,
        description: description.value,
        clonedFrom: seed.clonedFrom,
        slots: rows.map((row) => ({
          id: row.dataset.slotId,
          label: row.querySelector(".collections-builder-label").value,
          year: row.querySelector(".collections-builder-year").value,
          note: row.querySelector(".collections-builder-note").value,
        })),
      };
      const result = seed.editId ? store.updateCustom(seed.editId, spec) : store.createCustom(spec);
      if (!result.ok) {
        const reasons = {
          "invalid-name": "Give the collection a name.",
          "no-slots": "Add at least one labelled slot.",
        };
        toast(reasons[result.reason] || "Could not save the collection.");
        return;
      }
      const savedId = seed.editId || result.collection.id;
      closeModalById(BUILDER_MODAL_ID);
      toast(seed.editId ? "Collection updated." : "Collection created.");
      await persistChosenImages(savedId, cover, rows);
      if (
        !seed.editId &&
        window.collectionsUI &&
        typeof window.collectionsUI.openCollection === "function"
      ) {
        window.collectionsUI.openCollection(savedId);
      }
    };

    shell.footer.replaceChildren(
      el(
        "span",
        "collections-builder-hint",
        "Custom collections back up with the rest of your data."
      ),
      (() => {
        const group = el("span", "collections-modal-footer-actions");
        group.append(
          button("btn secondary collections-btn-pill", "Cancel", () =>
            closeModalById(BUILDER_MODAL_ID)
          ),
          button(
            "btn collections-btn-pill",
            seed.editId ? "Save changes" : "Create collection",
            submit
          )
        );
        return group;
      })()
    );
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
    saveImage,
    deleteImage,
  });
})();

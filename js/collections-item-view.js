// COLLECTIONS — ITEM VIEW INTEGRATION (STRK-368, epic STRK-254)
// =============================================================================
// Shows, inside the item view modal, which Collections an Item belongs to:
//   - a header chip per membership ("ASE Type 2 · 2024"), next to the N# / count chips
//   - a "Collections" section with the slot, role (primary / spare), set progress,
//     and Open / Unlink actions
//
// js/viewModal.js stays thin: it calls buildSection(item) from its section-builder map
// and renderHeaderChips(item) from its header renderer, both guarded, the same seam
// style as buildTagSection() in js/tags.js. Membership is read from the Collection
// (collectionsStore.memberships) — the Item carries no collection field.
//
// DOM-built with textContent only: collection names and slot labels are user-authored.
// MUST load after collections-store.js.
// =============================================================================

(() => {
  "use strict";

  const CHIP_CLASS = "collections-view-chip";

  /**
   * Creates an element with optional classes and text.
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
   * Whether the user has left the Collections tab visible in Settings > Layout.
   *
   * Collection membership stays stored even while its tab is hidden; suppressing
   * the Item-modal affordances avoids offering an Open action that can only
   * redirect the user to Dashboard.
   * @returns {boolean} True when the Collections tab is visible or unavailable to inspect
   */
  const isTabVisible = () => {
    try {
      if (typeof window.getLayoutTabConfig !== "function") return true;
      const tabs = window.getLayoutTabConfig();
      if (!Array.isArray(tabs)) return true;
      const collectionsTab = tabs.find((tab) => tab?.id === "collections");
      return !collectionsTab || collectionsTab.enabled;
    } catch {
      return true;
    }
  };

  /**
   * Whether Collections affordances can be shown in the Item modal.
   * @returns {boolean} True when memberships can be shown
   */
  const isEnabled = () => Boolean(window.collectionsStore) && isTabVisible();

  /**
   * Clears Collection affordances from an already-open Item View when the tab
   * becomes hidden in Settings. Membership stays stored in collectionState.
   * @returns {void}
   */
  const syncVisibility = () => {
    if (isTabVisible()) return;
    const modal = document.getElementById("viewItemModal");
    if (!modal || modal.style.display === "none") return;
    modal.querySelectorAll(`.${CHIP_CLASS}, .collections-view-section`).forEach((node) => {
      node.remove();
    });
  };

  /**
   * Display facts for one membership.
   * @param {{collectionId: string, slotId: string, role: string}} membership - Membership record
   * @returns {{title: string, shortTitle: string, slotLabel: string, progress: Object}|null} Facts, or null
   */
  const describe = (membership) => {
    const store = window.collectionsStore;
    const collection = store.getState().collections[membership.collectionId];
    if (!collection) return null;
    const template = store.templateFor(collection);
    const slot = store.slotDefs(collection).find((def) => def.id === membership.slotId);
    const base = collection.name || (template ? template.name : "Collection");
    const variant = template && template.variant ? template.variant : "";
    const label = slot
      ? `${slot.label || slot.year || slot.id}${slot.tag ? ` ${slot.tag}` : ""}`
      : membership.slotId;
    return {
      title: variant ? `${base} — ${variant}` : base,
      shortTitle: variant ? `${base} ${variant}` : base,
      slotLabel: label,
      progress: store.progress(collection),
    };
  };

  /**
   * Closes the item view and opens a collection's album.
   * @param {string} collectionId - Collection id
   * @returns {void}
   */
  const openCollection = (collectionId) => {
    if (typeof closeViewModal === "function") closeViewModal();
    if (window.collectionsUI && typeof window.collectionsUI.openCollection === "function") {
      window.collectionsUI.openCollection(collectionId);
      return;
    }
    window.location.hash = `#/collections/${collectionId}`;
  };

  /**
   * Renders one chip per membership into the view modal's badge row, replacing any
   * chips left from the previously viewed item.
   * @param {Object} item - Inventory item being viewed
   * @returns {void}
   */
  const renderHeaderChips = (item) => {
    const badges = document.querySelector("#viewItemModal .view-header-badges");
    if (!badges) return;
    badges.querySelectorAll(`.${CHIP_CLASS}`).forEach((chip) => chip.remove());
    if (!isEnabled() || !item || !item.uuid) return;
    const anchor = document.getElementById("viewHeaderActions");
    window.collectionsStore.memberships(item.uuid).forEach((membership) => {
      const facts = describe(membership);
      if (!facts) return;
      const chip = el("button", CHIP_CLASS, `${facts.shortTitle} · ${facts.slotLabel}`);
      chip.type = "button";
      chip.title = `Open ${facts.title}`;
      chip.addEventListener("click", () => openCollection(membership.collectionId));
      badges.insertBefore(chip, anchor && anchor.parentNode === badges ? anchor : null);
    });
  };

  /**
   * One membership row: title, slot + role + progress, Open / Unlink.
   * @param {Object} item - Inventory item being viewed
   * @param {{collectionId: string, slotId: string, role: string}} membership - Membership record
   * @param {Function} onChanged - Called after an unlink so the caller can refresh
   * @returns {HTMLElement|null} Row element
   */
  const membershipRow = (item, membership, onChanged) => {
    const facts = describe(membership);
    if (!facts) return null;
    const row = el("div", "collections-view-row");
    const main = el("div", "collections-view-main");
    main.appendChild(el("div", "collections-view-title", facts.title));
    const { owned, total, pct } = facts.progress;
    main.appendChild(
      el(
        "div",
        "collections-view-meta",
        `${facts.slotLabel} slot · ${membership.role} · ${owned} of ${total} collected`
      )
    );
    const bar = el("div", "collections-progress");
    if (total > 0 && owned === total) bar.classList.add("is-complete");
    const fill = el("span");
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    main.appendChild(bar);

    const actions = el("div", "collections-view-actions");
    const open = el("button", "collections-textlink", "Open");
    open.type = "button";
    open.addEventListener("click", () => openCollection(membership.collectionId));
    const unlink = el("button", "collections-textlink is-muted", "Unlink");
    unlink.type = "button";
    unlink.addEventListener("click", () => {
      const result = window.collectionsStore.unlink(
        membership.collectionId,
        membership.slotId,
        item.uuid
      );
      if (result.ok) onChanged();
    });
    actions.append(open, unlink);
    row.append(main, actions);
    return row;
  };

  /**
   * Builds the "Collections" section for the item view modal.
   * @param {Object} item - Inventory item being viewed
   * @returns {HTMLElement|null} Section, or null when the item is in no collection
   */
  const buildSection = (item) => {
    if (!isEnabled() || !item || !item.uuid) return null;
    if (!window.collectionsStore.memberships(item.uuid).length) return null;
    const section = el("div", "view-detail-section collections-view-section");
    section.appendChild(el("div", "view-section-title", "Collections"));
    const list = el("div", "collections-view-list");
    section.appendChild(list);

    const renderRows = () => {
      const rows = window.collectionsStore
        .memberships(item.uuid)
        .map((membership) => membershipRow(item, membership, renderRows))
        .filter(Boolean);
      list.replaceChildren(...rows);
      renderHeaderChips(item);
      // The last membership was unlinked: drop the now-empty section.
      if (!rows.length) section.remove();
    };
    renderRows();
    return section;
  };

  window.collectionsItemView = Object.freeze({ buildSection, renderHeaderChips, syncVisibility });
})();

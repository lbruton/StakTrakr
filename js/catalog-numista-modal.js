// CATALOG · NUMISTA RESULTS MODAL (STRK-178)
// =============================================================================
// The Numista search-results modal + field-picker UI, extracted verbatim from
// js/catalog-api.js to keep each file under the Codacy Lizard file-nloc gate
// (2500). Pure code motion — no behavior change. Holds: escapeHtmlCatalog,
// buildNumistaCatalogUrl, renderCatalogIdAction, renderNumistaResultCard,
// renderNumistaSelectedItem, isValidSelectOption, renderNumistaFieldCheckboxes,
// getPopularNumistaItems, showNumistaResults, parseGoldbackDenomination,
// fillFormFromNumistaResult, closeNumistaResultsModal, renderNumistaUsageBar,
// renderPcgsUsageBar, the selectedNumistaResult state, the shared
// USER_MODIFIED_TRACKED_FIELDS / NUMISTA_DATA_PICKER_KEYS field sets, and the
// modal's DOMContentLoaded event wiring.
//
// Bare global declarations (no IIFE) — other modules keep calling these as
// globals with no call-site change. Calls catalog-api.js (catalogAPI,
// catalogConfig), utils.js, and events.js helpers at runtime only, so load
// order alone suffices. Loads after js/catalog-api.js in index.html.
// =============================================================================

// Fields that carry userModified tracking (shared by renderNumistaFieldCheckboxes + fillFormFromNumistaResult)
const USER_MODIFIED_TRACKED_FIELDS = new Set([
  "name",
  "type",
  "weight",
  "year",
  "metal",
  // Numista Data tab fields (STRK-51)
  "country",
  "denomination",
  "composition",
  "shape",
  "diameter",
  "length",
  "width",
  "thickness",
  "orientation",
  "technique",
  "mintage",
  "rarityIndex",
  "kmRef",
  "commemorative",
  "commemorativeDesc",
  "obverseDesc",
  "reverseDesc",
  "edgeDesc",
]);

// All numistaData field keys that appear as picker rows (STRK-51)
const NUMISTA_DATA_PICKER_KEYS = new Set([
  "country",
  "denomination",
  "composition",
  "shape",
  "diameter",
  "length",
  "width",
  "thickness",
  "orientation",
  "technique",
  "mintage",
  "rarityIndex",
  "kmRef",
  "commemorative",
  "commemorativeDesc",
  "obverseDesc",
  "reverseDesc",
  "edgeDesc",
]);

/** @type {Object|null} Currently selected Numista search result (modal state) */
let selectedNumistaResult = null;

// =============================================================================
// NUMISTA RESULTS MODAL — Search results + field picker UI
// =============================================================================

/**
 * Escape HTML for safe insertion into innerHTML
 * @param {string} str - Raw string
 * @returns {string} Escaped string
 */
const escapeHtmlCatalog = (str) =>
  String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Build a safe Numista catalogue URL from a catalog id.
 * Supports piece ids (e.g. "75250", "N#75250") and set ids (e.g. "S123", "N#S123").
 *
 * @param {string} catalogId - Raw catalog id
 * @returns {string} Absolute Numista URL or empty string when invalid
 */
const buildNumistaCatalogUrl = (catalogId) => {
  const raw = String(catalogId || "").trim();
  if (!raw) return "";

  // Strip N# prefix first, THEN detect S for sets
  const stripped = raw.replace(/^N#\s*/i, "").trim();
  const isSet = /^S/i.test(stripped);
  const clean = isSet ? stripped.replace(/^S/i, "").trim() : stripped;
  if (!/^\d+$/.test(clean)) return "";

  return isSet
    ? `https://en.numista.com/catalogue/set.php?id=${clean}`
    : `https://en.numista.com/catalogue/pieces${clean}.html`;
};

/**
 * Render a single result card HTML string
 * @param {Object} result - Normalized Numista item data
 * @param {number} index - Index in results array
 * @returns {string} HTML string
 */
/**
 * Render catalog ID as a clickable link (when URL is available) or plain span.
 * @param {string} catalogId - Raw catalog ID from Numista
 * @returns {string} HTML string
 */
const renderCatalogIdAction = (catalogId) => {
  const numistaUrl = buildNumistaCatalogUrl(catalogId);
  const catalogIdLabel = `N#${escapeHtmlCatalog(catalogId)}`;
  return numistaUrl
    ? `<button type="button" class="numista-result-id numista-result-id-link" onclick="openNumistaModal('${escapeHtmlCatalog(catalogId)}','')" aria-label="Open ${catalogIdLabel} on Numista">${catalogIdLabel}</button>`
    : `<span class="numista-result-id">${catalogIdLabel}</span>`;
};

const renderNumistaResultCard = (result, index) => {
  const placeholder = `<div class="numista-img-placeholder">🪙</div>`;
  const obverseImg = result.imageUrl
    ? `<img src="${escapeHtmlCatalog(result.imageUrl)}" alt="Obverse" loading="lazy">`
    : placeholder;
  const reverseImg = result.reverseImageUrl
    ? `<img src="${escapeHtmlCatalog(result.reverseImageUrl)}" alt="Reverse" loading="lazy">`
    : "";
  const meta = [
    result.year,
    result.country,
    result.metal,
    result.weight ? `${result.weight}g` : "",
    result.type,
  ]
    .filter(Boolean)
    .join(" · ");
  const catalogIdAction = renderCatalogIdAction(result.catalogId);

  return `<div class="numista-result-card" data-result-index="${index}">
    <div class="numista-result-images">${obverseImg}${reverseImg}</div>
    <div class="numista-result-info">
      <div class="numista-result-name">${escapeHtmlCatalog(result.name)}</div>
      <div class="numista-result-meta">${escapeHtmlCatalog(meta)}</div>
      <div class="numista-result-footer">
        ${catalogIdAction}
      </div>
    </div>
  </div>`;
};

/**
 * Render the selected item preview in field picker
 * @param {Object} result - Normalized Numista item data
 * @returns {string} HTML string
 */
const renderNumistaSelectedItem = (result) => {
  const placeholder = `<div class="numista-img-placeholder">🪙</div>`;
  const obverseImg = result.imageUrl
    ? `<img src="${escapeHtmlCatalog(result.imageUrl)}" alt="Obverse" loading="lazy">`
    : placeholder;
  const reverseImg = result.reverseImageUrl
    ? `<img src="${escapeHtmlCatalog(result.reverseImageUrl)}" alt="Reverse" loading="lazy">`
    : "";
  const meta = [
    result.year,
    result.country,
    result.metal,
    result.weight ? `${result.weight}g` : "",
    result.type,
  ]
    .filter(Boolean)
    .join(" · ");
  const catalogIdAction = renderCatalogIdAction(result.catalogId);

  return `<div class="numista-result-images">${obverseImg}${reverseImg}</div>
    <div class="numista-result-info">
      <div class="numista-result-name">${escapeHtmlCatalog(result.name)}</div>
      <div class="numista-result-meta">${escapeHtmlCatalog(meta)}</div>
      <div class="numista-result-footer">
        ${catalogIdAction}
      </div>
    </div>`;
};

/**
 * Check if a value matches a valid <select> option
 * @param {string} selectId - DOM id of the select element
 * @param {string} value - Value to check
 * @returns {boolean}
 */
const isValidSelectOption = (selectId, value) => {
  const el = document.getElementById(selectId);
  if (!el) return false;
  return Array.from(el.options).some((o) => o.value === value);
};

/**
 * Render field checkboxes with editable input fields for the selected result.
 * Each row: [checkbox] [label] [editable text input]
 * User can tweak values before hitting "Fill Fields".
 * @param {Object} result - Normalized Numista item data
 */
const renderNumistaFieldCheckboxes = (result) => {
  const container = document.getElementById("numistaFieldCheckboxes");
  if (!container) return;

  // Resolve editing item for userModified awareness (skip in bulk-edit context)
  const isBulkEdit = typeof window._bulkEditNumistaCallback === "function";
  let editingItem = null;
  if (!isBulkEdit) {
    const idx = typeof editingIndex !== "undefined" && editingIndex !== null ? editingIndex : null;
    editingItem = idx !== null && Array.isArray(inventory) ? inventory[idx] : null;
  }
  const fieldMetaMap = editingItem?.fieldMeta || {};
  const editingUuid = editingItem?.uuid || null;

  // Fields with userModified tracking (name, type, weight, year, metal)
  const userModifiedTracked = USER_MODIFIED_TRACKED_FIELDS;

  const typeValid = result.type && isValidSelectOption("itemType", result.type);
  const metalValid =
    result.metal &&
    result.metal !== "Alloy/Other" &&
    isValidSelectOption("itemMetal", result.metal);

  // Fields ordered: primary (checked by default) first, then optional (unchecked)
  const fields = [
    { key: "name", label: "Name", value: result.name || "", available: true, defaultOn: true },
    {
      key: "catalog",
      label: "Catalog N#",
      value: result.catalogId || "",
      available: true,
      defaultOn: true,
    },
    {
      key: "year",
      label: "Year",
      value: result.year || "",
      available: !!result.year,
      defaultOn: !!result.year,
    },
    {
      key: "type",
      label: "Type",
      value: result.type || "",
      available: typeValid,
      defaultOn: typeValid,
      warn: result.type && !typeValid ? `"${result.type}" — not in form options` : "",
    },
    {
      key: "weight",
      label: "Weight (g)",
      value: result.weight ? String(result.weight) : "",
      available: result.weight > 0,
      defaultOn: result.weight > 0,
    },
    {
      key: "obverseImage",
      label: "Obverse Image",
      value: result.imageUrl || "",
      available: !!result.imageUrl,
      defaultOn: true,
    },
    {
      key: "reverseImage",
      label: "Reverse Image",
      value: result.reverseImageUrl || "",
      available: !!result.reverseImageUrl,
      defaultOn: true,
    },
    {
      key: "metal",
      label: "Metal",
      value: result.metal || "",
      available: metalValid,
      defaultOn: metalValid,
      warn: result.metal && !metalValid ? `"${result.metal}" — not in form options` : "",
    },
  ];

  // Keep the heading, rebuild field rows
  const heading = container.querySelector(".numista-fields-heading");
  container.innerHTML = "";
  if (heading) {
    container.appendChild(heading);
  } else {
    const h = document.createElement("div");
    h.className = "numista-fields-heading";
    h.textContent = "Fields to fill:";
    container.appendChild(h);
  }

  // Map field keys to current form values for "Current:" hints
  const currentFormValues = {
    name: (elements.itemName || safeGetElement("itemName"))?.value?.trim() || "",
    catalog: (elements.itemCatalog || safeGetElement("itemCatalog"))?.value?.trim() || "",
    year: (elements.itemYear || safeGetElement("itemYear"))?.value?.trim() || "",
    type: (elements.itemType || safeGetElement("itemType"))?.value || "",
    weight: (elements.itemWeight || safeGetElement("itemWeight"))?.value?.trim() || "",
    obverseImage:
      (elements.itemObverseImageUrl || safeGetElement("itemObverseImageUrl"))?.value?.trim() || "",
    reverseImage:
      (elements.itemReverseImageUrl || safeGetElement("itemReverseImageUrl"))?.value?.trim() || "",
    metal: (elements.itemMetal || safeGetElement("itemMetal"))?.value || "",
    // Numista Data tab fields (STRK-51)
    country: safeGetElement("numistaCountry")?.value?.trim() || "",
    denomination: safeGetElement("numistaDenomination")?.value?.trim() || "",
    composition: safeGetElement("numistaComposition")?.value?.trim() || "",
    shape: safeGetElement("numistaShape")?.value?.trim() || "",
    diameter: safeGetElement("numistaDiameter")?.value?.trim() || "",
    thickness: safeGetElement("numistaThickness")?.value?.trim() || "",
    length: safeGetElement("numistaLength")?.value?.trim() || "",
    width: safeGetElement("numistaWidth")?.value?.trim() || "",
    orientation: safeGetElement("numistaOrientation")?.value?.trim() || "",
    technique: safeGetElement("numistaTechnique")?.value?.trim() || "",
    mintage: safeGetElement("numistaMintage")?.value?.trim() || "",
    rarityIndex: safeGetElement("numistaRarity")?.value?.trim() || "",
    kmRef: safeGetElement("numistaKmRef")?.value?.trim() || "",
    commemorative: safeGetElement("numistaCommemorative")?.checked ? "Yes" : "",
    commemorativeDesc: safeGetElement("numistaCommemorativeDesc")?.value?.trim() || "",
    obverseDesc: safeGetElement("numistaObverseDesc")?.value?.trim() || "",
    reverseDesc: safeGetElement("numistaReverseDesc")?.value?.trim() || "",
    edgeDesc: safeGetElement("numistaEdgeDesc")?.value?.trim() || "",
  };

  fields.forEach((f) => {
    // Check userModified for tracked fields
    const isUserModified =
      !isBulkEdit && userModifiedTracked.has(f.key) && fieldMetaMap[f.key]?.userModified === true;

    // Row wrapper — display:contents preserves the parent 3-column grid layout
    const row = document.createElement("div");
    row.className = "numista-field-row";

    // Checkbox — grid column 1
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.name = "numistaField";
    cb.value = f.key;
    // userModified fields default unchecked; others use existing defaultOn logic
    const effectiveDefaultOn = isUserModified ? false : f.defaultOn;
    cb.checked = f.available && !!f.value && effectiveDefaultOn;
    if (!f.value) cb.disabled = true;

    // Label — grid column 2
    const label = document.createElement("span");
    label.className = "numista-field-label";
    label.textContent = f.label + ":";

    // Editable text input — grid column 3
    const input = document.createElement("input");
    input.type = "text";
    input.className = "numista-field-input";
    input.name = "numistaFieldValue_" + f.key;
    input.value = f.value;
    input.placeholder = f.available ? "" : "N/A";
    if (!f.available && !f.value) input.disabled = true;

    // Toggle input enabled/disabled when checkbox changes
    cb.addEventListener("change", () => {
      input.disabled = !cb.checked;
    });
    if (!cb.checked) input.disabled = true;

    row.appendChild(cb);
    row.appendChild(label);
    row.appendChild(input);

    // "Current:" hint showing existing form value (helps user compare before filling)
    const currentVal = currentFormValues[f.key];
    if (currentVal) {
      const hint = document.createElement("div");
      hint.className = "numista-field-current";
      hint.textContent = `Current: ${currentVal}`;
      hint.title = currentVal;
      row.appendChild(hint);
    }

    // userModified indicator: shown regardless of whether there is a current value
    if (isUserModified) {
      const editedHint = document.createElement("span");
      editedHint.className = "numista-field-edited";
      editedHint.textContent = "\u270e edited";
      row.appendChild(editedHint);
    }

    // Warning text spanning all columns (e.g. "Alloy/Other — not in form options")
    if (f.warn) {
      const warn = document.createElement("div");
      warn.className = "numista-field-warn";
      warn.textContent = f.warn;
      row.appendChild(warn);
    }

    container.appendChild(row);
  });

  // ---------------------------------------------------------------------------
  // Numista Data tab fields (STRK-51)
  // ---------------------------------------------------------------------------
  const mintageCandidate = (() => {
    if (!result.mintageByYear?.length) return "";
    const first = result.mintageByYear[0];
    return typeof first.mintage === "number"
      ? first.mintage.toLocaleString()
      : String(first.mintage || "");
  })();

  const numistaDataFields = [
    {
      key: "country",
      label: "Country",
      value: result.country || "",
      available: !!result.country,
      defaultOn: true,
    },
    {
      key: "denomination",
      label: "Denomination",
      value: result.denomination || "",
      available: !!result.denomination,
      defaultOn: true,
    },
    {
      key: "composition",
      label: "Composition",
      value: result.composition || "",
      available: !!result.composition,
      defaultOn: true,
    },
    {
      key: "shape",
      label: "Shape",
      value: result.shape || "",
      available: !!result.shape,
      defaultOn: true,
    },
    {
      key: "diameter",
      label: "Diameter (mm)",
      value: result.diameter > 0 ? String(result.diameter) : "",
      available: result.diameter > 0,
      defaultOn: true,
    },
    {
      key: "length",
      label: "Length (mm)",
      value: result.length > 0 ? String(result.length) : "",
      available: result.length > 0,
      defaultOn: true,
    },
    {
      key: "width",
      label: "Width (mm)",
      value: result.width > 0 ? String(result.width) : "",
      available: result.width > 0,
      defaultOn: true,
    },
    {
      key: "thickness",
      label: "Thickness (mm)",
      value: result.thickness > 0 ? String(result.thickness) : "",
      available: result.thickness > 0,
      defaultOn: true,
    },
    {
      key: "orientation",
      label: "Orientation",
      value: result.orientation || "",
      available: !!result.orientation,
      defaultOn: !!result.orientation,
    },
    {
      key: "technique",
      label: "Technique",
      value: result.technique || "",
      available: !!result.technique,
      defaultOn: !!result.technique,
    },
    {
      key: "mintage",
      label: "Mintage",
      value: mintageCandidate,
      available: !!mintageCandidate,
      defaultOn: true,
    },
    {
      key: "rarityIndex",
      label: "Rarity Index",
      value: result.rarityIndex != null ? String(result.rarityIndex) : "",
      available: result.rarityIndex != null,
      defaultOn: result.rarityIndex != null && result.rarityIndex !== 0,
    },
    {
      key: "kmRef",
      label: "KM Reference",
      value: result.kmReferences?.length ? result.kmReferences.join(", ") : "",
      available: !!result.kmReferences?.length,
      defaultOn: true,
    },
    {
      key: "commemorative",
      label: "Commemorative",
      value: result.commemorative ? "Yes" : "",
      available: !!result.commemorative,
      defaultOn: true,
    },
    {
      key: "commemorativeDesc",
      label: "Commemorative Desc",
      value: result.commemorativeDesc || "",
      available: !!result.commemorativeDesc,
      defaultOn: !!result.commemorativeDesc,
    },
    {
      key: "obverseDesc",
      label: "Obverse Description",
      value: result.obverseDesc || "",
      available: !!result.obverseDesc,
      defaultOn: !!result.obverseDesc,
    },
    {
      key: "reverseDesc",
      label: "Reverse Description",
      value: result.reverseDesc || "",
      available: !!result.reverseDesc,
      defaultOn: !!result.reverseDesc,
    },
    {
      key: "edgeDesc",
      label: "Edge Description",
      value: result.edgeDesc || "",
      available: !!result.edgeDesc,
      defaultOn: !!result.edgeDesc,
    },
  ];

  // Only add the section if at least one field has a candidate value
  const hasNumistaDataCandidates = numistaDataFields.some((f) => f.available && f.value);
  if (hasNumistaDataCandidates) {
    const sectionLabel = document.createElement("div");
    sectionLabel.className = "numista-fields-section-label";
    sectionLabel.textContent = "Numista Data fields:";
    container.appendChild(sectionLabel);

    numistaDataFields.forEach((f) => {
      const isUserModified =
        !isBulkEdit &&
        USER_MODIFIED_TRACKED_FIELDS.has(f.key) &&
        fieldMetaMap[f.key]?.userModified === true;

      const row = document.createElement("div");
      row.className = "numista-field-row";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = "numistaField";
      cb.value = f.key;
      const effectiveDefaultOn = isUserModified ? false : f.defaultOn;
      cb.checked = f.available && !!f.value && effectiveDefaultOn;
      if (!f.value) cb.disabled = true;

      const label = document.createElement("span");
      label.className = "numista-field-label";
      label.textContent = f.label + ":";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "numista-field-input";
      input.name = "numistaFieldValue_" + f.key;
      input.value = f.value;
      input.placeholder = f.available ? "" : "N/A";
      if (!f.available && !f.value) input.disabled = true;

      cb.addEventListener("change", () => {
        input.disabled = !cb.checked;
      });
      if (!cb.checked) input.disabled = true;

      row.appendChild(cb);
      row.appendChild(label);
      row.appendChild(input);

      const currentVal = currentFormValues[f.key];
      if (currentVal) {
        const hint = document.createElement("div");
        hint.className = "numista-field-current";
        hint.textContent = `Current: ${currentVal}`;
        hint.title = currentVal;
        row.appendChild(hint);
      }

      if (isUserModified) {
        const editedHint = document.createElement("span");
        editedHint.className = "numista-field-edited";
        editedHint.textContent = "✎ edited";
        row.appendChild(editedHint);
      }

      container.appendChild(row);
    });
  }

  // ---------------------------------------------------------------------------
  // Tag checkbox section (STAK-556)
  // ---------------------------------------------------------------------------
  const numistaTagsAuto =
    typeof loadDataSync === "function" ? loadDataSync("numista_tags_auto", true) : true;
  const itemCurrentTags = editingUuid
    ? typeof getItemTags === "function"
      ? getItemTags(editingUuid)
      : []
    : [];
  const removedTags =
    !isBulkEdit && editingUuid
      ? typeof loadRemovedTags === "function"
        ? loadRemovedTags(editingUuid)
        : []
      : [];

  const tagList = result.tags || (selectedNumistaResult && selectedNumistaResult.tags) || [];

  if (tagList.length > 0) {
    // Separator
    const sep = document.createElement("div");
    sep.className = "numista-tag-separator";
    container.appendChild(sep);

    // Heading row with "Tags:" label and check/uncheck all buttons
    const headingRow = document.createElement("div");
    headingRow.className = "numista-tag-heading-row";

    const tagsHeading = document.createElement("span");
    tagsHeading.className = "numista-fields-subheading";
    tagsHeading.textContent = "Tags:";
    headingRow.appendChild(tagsHeading);

    const checkAllBtn = document.createElement("span");
    checkAllBtn.id = "numistaTagCheckAll";
    checkAllBtn.className = "numista-tag-actions";
    checkAllBtn.textContent = "Check all";
    headingRow.appendChild(checkAllBtn);

    const uncheckAllBtn = document.createElement("span");
    uncheckAllBtn.id = "numistaTagUncheckAll";
    uncheckAllBtn.className = "numista-tag-actions";
    uncheckAllBtn.textContent = "Uncheck all";
    headingRow.appendChild(uncheckAllBtn);

    container.appendChild(headingRow);

    // Tags container
    const tagsSection = document.createElement("div");
    tagsSection.className = "numista-tags-section";

    tagList.forEach((rawTag) => {
      const capitalized = String(rawTag).charAt(0).toUpperCase() + String(rawTag).slice(1);

      const isBlacklisted =
        typeof isTagBlacklisted === "function" ? isTagBlacklisted(capitalized) : false;
      const isOnItem = itemCurrentTags.some((t) => t.toLowerCase() === capitalized.toLowerCase());
      const isRemoved =
        !isBulkEdit && removedTags.some((t) => t.toLowerCase() === capitalized.toLowerCase());

      // Wrapper is a <label> so tests can use label:has(input[data-tag="..."])
      const wrapper = document.createElement("label");
      wrapper.className = "numista-tag-cb-wrap";
      if (isBlacklisted) wrapper.classList.add("numista-tag-dimmed");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = "numistaTag";
      cb.dataset.tag = capitalized;

      const tagLabel = document.createElement("span");
      tagLabel.textContent = capitalized;

      if (isBlacklisted) {
        cb.checked = false;
        cb.disabled = true;
        const hint = document.createElement("span");
        hint.className = "numista-tag-hint";
        hint.textContent = "(blacklisted)";
        wrapper.appendChild(cb);
        wrapper.appendChild(tagLabel);
        wrapper.appendChild(hint);
      } else if (isOnItem) {
        cb.checked = true;
        cb.dataset.onItem = "1"; // interactable (user can opt-out); not locked like blacklisted
        const hint = document.createElement("span");
        hint.className = "numista-tag-hint";
        hint.textContent = "(on item)";
        wrapper.appendChild(cb);
        wrapper.appendChild(tagLabel);
        wrapper.appendChild(hint);
      } else if (isRemoved) {
        cb.checked = false;
        const hint = document.createElement("span");
        hint.className = "numista-tag-hint";
        hint.textContent = "(removed \u21a9)";
        wrapper.appendChild(cb);
        wrapper.appendChild(tagLabel);
        wrapper.appendChild(hint);
      } else {
        cb.checked = !!numistaTagsAuto;
        wrapper.appendChild(cb);
        wrapper.appendChild(tagLabel);
      }

      // STRK-84: track user intent for Add-mode opt-out recording
      cb.addEventListener("change", () => {
        cb.dataset.userTouched = "1";
      });

      tagsSection.appendChild(wrapper);
    });

    container.appendChild(tagsSection);

    // Check all / Uncheck all event handlers
    checkAllBtn.addEventListener("click", () => {
      // Check-all: skip only blacklisted (disabled). On-item rows are already checked, so no-op is correct.
      tagsSection.querySelectorAll('input[name="numistaTag"]').forEach((cb) => {
        if (!cb.disabled) {
          cb.dataset.userTouched = "1";
          cb.checked = true;
        }
      });
    });

    uncheckAllBtn.addEventListener("click", () => {
      // Uncheck-all: skip blacklisted (!cb.disabled) AND on-item (!cb.dataset.onItem) — asymmetric by design.
      // Check-all only needs the blacklist guard; Uncheck-all needs both to preserve user opt-in signals.
      tagsSection.querySelectorAll('input[name="numistaTag"]').forEach((cb) => {
        if (!cb.disabled && !cb.dataset.onItem) {
          cb.dataset.userTouched = "1";
          cb.checked = false;
        }
      });
    });
  }
};

/**
 * Curated list of popular bullion items for quick-pick in the no-results modal.
 * Focused on items silver/gold stackers commonly own.
 * @returns {Array<{id: string, name: string, metal: string}>}
 */
const getPopularNumistaItems = () => [
  // Silver bullion
  { id: "1493", name: "American Silver Eagle", metal: "Silver" },
  { id: "298883", name: "American Silver Eagle (New Rev)", metal: "Silver" },
  { id: "9164", name: "Canadian Silver Maple Leaf", metal: "Silver" },
  { id: "13410", name: "British Silver Britannia", metal: "Silver" },
  { id: "9165", name: "Austrian Silver Philharmonic", metal: "Silver" },
  { id: "13855", name: "Mexican Silver Libertad", metal: "Silver" },
  { id: "143754", name: "Silver Krugerrand", metal: "Silver" },
  // Gold bullion
  { id: "23134", name: "American Gold Eagle", metal: "Gold" },
  { id: "18451", name: "American Gold Buffalo", metal: "Gold" },
  { id: "6002", name: "Gold Krugerrand", metal: "Gold" },
  { id: "15150", name: "Austrian Gold Philharmonic", metal: "Gold" },
  // Classic silver
  { id: "1492", name: "Morgan Dollar", metal: "Silver" },
  { id: "5580", name: "Peace Dollar", metal: "Silver" },
];

/**
 * Show Numista results modal with search results
 * @param {Array} results - Array of normalized Numista item data
 * @param {boolean} directLookup - If true and single result, skip list and show field picker
 * @param {string} originalQuery - The search query used (for retry pre-fill)
 */
const showNumistaResults = (results, directLookup = false, originalQuery = "") => {
  const modal = document.getElementById("numistaResultsModal");
  const list = document.getElementById("numistaResultsList");
  const picker = document.getElementById("numistaFieldPicker");
  const title = document.getElementById("numistaResultsTitle");
  const preview = document.getElementById("numistaSelectedItem");
  if (!modal || !list || !picker) return;

  selectedNumistaResult = null;
  list.innerHTML = "";
  picker.style.display = "none";

  if (!results || results.length === 0) {
    title.textContent = "No Results";

    // Build quick-picks from curated popular items
    const popularItems = getPopularNumistaItems();
    const quickPicksHtml = `<div class="numista-quick-picks">
        <p class="numista-quick-picks-label">Popular bullion items:</p>
        <div class="numista-quick-picks-list">
          ${popularItems
            .map(
              (item) =>
                `<button type="button" class="numista-quick-pick" data-numista-id="${escapeHtmlCatalog(item.id)}">
              <span class="quick-pick-id">N#${escapeHtmlCatalog(item.id)}</span>
              <span class="quick-pick-name">${escapeHtmlCatalog(item.name)}</span>
              <span class="quick-pick-count">${escapeHtmlCatalog(item.metal)}</span>
            </button>`
            )
            .join("")}
        </div>
      </div>`;

    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    list.innerHTML = `<div class="numista-no-results-enhanced">
      <div class="numista-retry-search">
        <p>No matching items found on Numista.</p>
        <div class="numista-retry-row">
          <input type="text" id="numistaRetryInput" class="numista-retry-input"
                 placeholder="Refine your search..." value="${escapeHtmlCatalog(originalQuery)}">
          <button type="button" id="numistaRetryBtn" class="btn premium numista-retry-btn">Search</button>
        </div>
      </div>
      ${quickPicksHtml}
    </div>`;
    list.style.display = "block";
    modal.style.display = "flex";

    // Wire up retry search
    const retryBtn = document.getElementById("numistaRetryBtn");
    const retryInput = document.getElementById("numistaRetryInput");
    if (retryBtn && retryInput) {
      const doRetry = async () => {
        const query = retryInput.value.trim();
        if (!query) return;
        retryBtn.disabled = true;
        retryBtn.textContent = "Searching\u2026";
        try {
          const retryResults = await catalogAPI.searchItems(query, { limit: 20 });
          showNumistaResults(retryResults, false, query);
        } catch (err) {
          console.error("Numista retry search failed:", err);
          retryBtn.textContent = "Failed";
          setTimeout(() => {
            retryBtn.textContent = "Search";
            retryBtn.disabled = false;
          }, 1500);
        }
      };
      retryBtn.addEventListener("click", doRetry);
      retryInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doRetry();
      });
      // Auto-focus the search input for quick editing
      setTimeout(() => retryInput.select(), 50);
    }

    // Wire up quick-pick clicks
    list.querySelectorAll(".numista-quick-pick").forEach((pickBtn) => {
      pickBtn.addEventListener("click", async () => {
        const nId = pickBtn.dataset.numistaId;
        if (!nId) return;
        pickBtn.style.opacity = "0.5";
        pickBtn.disabled = true;
        try {
          const result = await catalogAPI.lookupItem(nId);
          showNumistaResults(result ? [result] : [], true, nId);
        } catch (err) {
          console.error("Numista quick-pick lookup failed:", err);
          pickBtn.style.opacity = "1";
          pickBtn.disabled = false;
        }
      });
    });

    return;
  }

  // Direct lookup with single result → skip to field picker
  if (directLookup && results.length === 1) {
    title.textContent = "Numista Item Found";
    list.style.display = "none";
    selectedNumistaResult = results[0];
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    preview.innerHTML = renderNumistaSelectedItem(results[0]);
    renderNumistaFieldCheckboxes(results[0]);
    picker.style.display = "block";
    modal.style.display = "flex";
    return;
  }

  // Multiple results → show selectable card list with search refinement
  title.textContent = `Numista Results (${results.length})`;
  // Stash results on the list element for delegated click retrieval
  list._numistaResults = results;

  // Build refinement search bar + result cards
  const searchBarHtml = `<div class="numista-refine-search">
    <input type="text" id="numistaRefineInput" class="numista-refine-input"
           placeholder="Refine search..." value="${escapeHtmlCatalog(originalQuery)}">
    <button type="button" id="numistaRefineBtn" class="btn premium numista-refine-btn">Search</button>
  </div>`;
  const cardsHtml = results
    .slice(0, 20)
    .map((r, i) => renderNumistaResultCard(r, i))
    .join("");
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  list.innerHTML = searchBarHtml + cardsHtml;
  list.style.display = "flex";
  modal.style.display = "flex";

  // Wire up refinement search
  const refineBtn = document.getElementById("numistaRefineBtn");
  const refineInput = document.getElementById("numistaRefineInput");
  if (refineBtn && refineInput) {
    const doRefine = async () => {
      const query = refineInput.value.trim();
      if (!query) return;
      refineBtn.disabled = true;
      refineBtn.textContent = "Searching\u2026";
      try {
        const refineResults = await catalogAPI.searchItems(query, { limit: 20 });
        showNumistaResults(refineResults, false, query);
      } catch (err) {
        console.error("Numista refine search failed:", err);
        refineBtn.textContent = "Failed";
        setTimeout(() => {
          refineBtn.textContent = "Search";
          refineBtn.disabled = false;
        }, 1500);
      }
    };
    refineBtn.addEventListener("click", doRefine);
    refineInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doRefine();
    });
    setTimeout(() => refineInput.select(), 50);
  }
};

/**
 * Fill form fields from the editable picker inputs.
 * Reads values from the numistaFieldValue_* text inputs (user may have edited them).
 */
/**
 * STRK-138: Parse a Goldback denomination weight from free-form text.
 * Matches Unicode/ASCII fractions and leading decimals, but only returns a value
 * if it exactly equals a canonical GOLDBACK_DENOMINATIONS weight.
 * Uses regex/parseFloat only — never eval()/Function() on the input string.
 * @param {string} text - Raw denomination text (e.g. "1/4 Idaho Goldback").
 * @returns {number|null} Matching weight, or null when no exact match.
 */
const parseGoldbackDenomination = (text) => {
  if (typeof text !== "string" || !text.trim()) return null;

  // Normalize the Unicode fractions present in GOLDBACK_DENOMINATIONS labels.
  const normalized = text.replace(/¼/g, "1/4").replace(/½/g, "1/2").replace(/¾/g, "3/4");

  let value = null;
  const fraction = normalized.match(/(\d+)\s*\/\s*(\d+)/);
  if (fraction) {
    const numerator = parseFloat(fraction[1]);
    const denominator = parseFloat(fraction[2]);
    if (denominator !== 0) value = numerator / denominator;
  } else {
    const decimal = normalized.match(/(\d+(?:\.\d+)?|\.\d+)/);
    if (decimal) value = parseFloat(decimal[1]);
  }

  if (value === null || Number.isNaN(value)) return null;

  const weights = Array.isArray(window.GOLDBACK_DENOMINATIONS)
    ? window.GOLDBACK_DENOMINATIONS
    : typeof GOLDBACK_DENOMINATIONS !== "undefined"
      ? GOLDBACK_DENOMINATIONS
      : [];
  // Compare at 6-decimal precision via integer rounding — goldback weights have
  // ≤2 decimals, so this is exact for all real inputs and avoids a float epsilon.
  const SCALE = 1000000;
  const match = weights.find((d) => Math.round(d.weight * SCALE) === Math.round(value * SCALE));
  return match ? match.weight : null;
};

const fillFormFromNumistaResult = () => {
  const container = document.getElementById("numistaFieldCheckboxes");
  if (!container) return;

  // Collect checked fields and their edited values from the picker inputs
  const checkboxes = container.querySelectorAll('input[name="numistaField"]');

  // Intercept for bulk edit — when callback is set, route field values there instead
  if (typeof window._bulkEditNumistaCallback === "function") {
    const fieldMap = {};
    checkboxes.forEach((cb) => {
      if (!cb.checked) return;
      const input = container.querySelector('input[name="numistaFieldValue_' + cb.value + '"]');
      if (input && input.value.trim()) fieldMap[cb.value] = input.value.trim();
    });
    window._bulkEditNumistaCallback(fieldMap);
    window._bulkEditNumistaCallback = null;
    closeNumistaResultsModal({ clearPendingSnapshot: true });
    return;
  }

  checkboxes.forEach((cb) => {
    if (!cb.checked) return;
    const input = container.querySelector(`input[name="numistaFieldValue_${cb.value}"]`);
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    switch (cb.value) {
      case "name": {
        const el = elements.itemName || safeGetElement("itemName");
        if (el) el.value = val;
        break;
      }
      case "year": {
        const el = elements.itemYear || safeGetElement("itemYear");
        if (el) el.value = val;
        break;
      }
      case "type": {
        const el = elements.itemType || safeGetElement("itemType");
        if (el) {
          const valid = Array.from(el.options).map((o) => o.value);
          if (valid.includes(val)) el.value = val;
        }
        break;
      }
      case "weight": {
        const el = elements.itemWeight || safeGetElement("itemWeight");
        const unitEl = safeGetElement("itemWeightUnit");
        const num = parseFloat(val);
        if (el && !isNaN(num) && num > 0) {
          el.value = num;
          if (unitEl) unitEl.value = "g";
        }
        break;
      }
      case "catalog": {
        const el = elements.itemCatalog || safeGetElement("itemCatalog");
        if (el) el.value = val;
        break;
      }
      case "obverseImage": {
        // STAK-488: Always write the URL when checkbox is checked — the user controls
        // whether to overwrite via the field picker checkbox, not this guard.
        const el = elements.itemObverseImageUrl || safeGetElement("itemObverseImageUrl");
        if (el instanceof HTMLElement) {
          el.value = val;
          // Programmatic .value doesn't fire input events; dispatch one so
          // scheduleUrlPreview() runs and the preview/frame-toggle UI updates
          // without requiring the user to save and re-edit the item.
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        break;
      }
      case "reverseImage": {
        const el = elements.itemReverseImageUrl || safeGetElement("itemReverseImageUrl");
        if (el instanceof HTMLElement) {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        break;
      }
      case "metal": {
        const el = elements.itemMetal || safeGetElement("itemMetal");
        if (el) {
          const valid = Array.from(el.options).map((o) => o.value);
          if (valid.includes(val)) el.value = val;
        }
        break;
      }
      // Numista Data tab fields (STRK-51)
      case "country": {
        const el = safeGetElement("numistaCountry");
        if (el) el.value = val;
        break;
      }
      case "denomination": {
        const el = safeGetElement("numistaDenomination");
        if (el) el.value = val;
        break;
      }
      case "composition": {
        const el = safeGetElement("numistaComposition");
        if (el) el.value = val;
        break;
      }
      case "shape": {
        const el = safeGetElement("numistaShape");
        if (el) el.value = val;
        break;
      }
      case "diameter": {
        const el = safeGetElement("numistaDiameter");
        if (el) el.value = val;
        break;
      }
      case "length": {
        const el = safeGetElement("numistaLength");
        if (el) el.value = val;
        break;
      }
      case "width": {
        const el = safeGetElement("numistaWidth");
        if (el) el.value = val;
        break;
      }
      case "thickness": {
        const el = safeGetElement("numistaThickness");
        if (el) el.value = val;
        break;
      }
      case "orientation": {
        const el = safeGetElement("numistaOrientation");
        if (el) el.value = val;
        break;
      }
      case "technique": {
        const el = safeGetElement("numistaTechnique");
        if (el) el.value = val;
        break;
      }
      case "mintage": {
        const el = safeGetElement("numistaMintage");
        if (el) el.value = val;
        break;
      }
      case "rarityIndex": {
        const el = safeGetElement("numistaRarity");
        if (el) el.value = val;
        break;
      }
      case "kmRef": {
        const el = safeGetElement("numistaKmRef");
        if (el) el.value = val;
        break;
      }
      case "commemorative": {
        const cb = safeGetElement("numistaCommemorative");
        if (cb) {
          cb.checked = val === "Yes";
          const wrap = safeGetElement("numistaCommemorativeDescWrap");
          if (wrap) wrap.style.display = cb.checked ? "" : "none";
        }
        break;
      }
      case "commemorativeDesc": {
        const el = safeGetElement("numistaCommemorativeDesc");
        if (el) el.value = val;
        break;
      }
      case "obverseDesc": {
        const el = safeGetElement("numistaObverseDesc");
        if (el) el.value = val;
        break;
      }
      case "reverseDesc": {
        const el = safeGetElement("numistaReverseDesc");
        if (el) el.value = val;
        break;
      }
      case "edgeDesc": {
        const el = safeGetElement("numistaEdgeDesc");
        if (el) el.value = val;
        break;
      }
    }
  });

  // STAK-488: Show URL input wrappers if we just filled image URLs (they're hidden by default)
  ["Obv", "Rev"].forEach((suffix) => {
    const wrap = document.getElementById("itemImageUrlInput" + suffix);
    const field = suffix === "Obv" ? elements.itemObverseImageUrl : elements.itemReverseImageUrl;
    if (wrap && field && field.value.trim()) wrap.style.display = "";
  });

  // Auto-populate Numista Data fields from the selected result (STAK-173)
  // STRK-51: Skip all picker-controlled fields — they were already applied above
  // (checked rows written synchronously; unchecked rows user declined to import).
  if (selectedNumistaResult && typeof populateNumistaDataFields === "function") {
    const catId = selectedNumistaResult.catalogId;
    if (catId && window.imageCache?.isAvailable()) {
      imageCache
        .cacheMetadata(catId, selectedNumistaResult)
        .then(() => {
          populateNumistaDataFields(catId, null, { skipFields: NUMISTA_DATA_PICKER_KEYS });
        })
        .catch(() => {});
    }
  }

  // STAK-556: Tag checkbox application and userModified clearing
  // Resolve editing item once — mirrors the pattern in renderNumistaFieldCheckboxes
  const _fillIdx =
    typeof editingIndex !== "undefined" && editingIndex !== null ? editingIndex : null;
  const _fillItem = _fillIdx !== null && Array.isArray(inventory) ? inventory[_fillIdx] : null;
  const _fillUuid = _fillItem?.uuid || null;

  // Apply checked tag checkboxes
  const tagCheckboxes = container.querySelectorAll('input[name="numistaTag"]:checked');
  if (tagCheckboxes.length > 0 && _fillUuid) {
    const checkedTags = Array.from(tagCheckboxes).map((cb) => cb.dataset.tag || cb.value);
    if (typeof applyNumistaTags === "function") {
      // force=true: user explicitly chose these tags via checkboxes
      applyNumistaTags(_fillUuid, checkedTags, true, true);
      if (typeof window._renderEditTags === "function") window._renderEditTags();
    }
    // Clear removal tracking for re-imported tags (batched: one load + one save)
    if (typeof loadDataSync === "function" && typeof saveDataSync === "function") {
      const map = loadDataSync("itemRemovedTags", {});
      if (Array.isArray(map[_fillUuid]) && map[_fillUuid].length > 0) {
        const checkedLower = new Set(checkedTags.map((t) => t.toLowerCase()));
        map[_fillUuid] = map[_fillUuid].filter((r) => !checkedLower.has(r.toLowerCase()));
        if (map[_fillUuid].length === 0) delete map[_fillUuid];
        saveDataSync("itemRemovedTags", map);
      }
    }
  }

  // STRK-52: Walk unchecked on-item checkboxes and record explicit opt-outs.
  // This runs outside the tagCheckboxes block so it fires even when zero tags are checked.
  // applyNumistaTags() only adds — it never removes existing tags — so getItemTags() still
  // returns the pre-submit stored list here, making the case-insensitive lookup safe.
  if (_fillUuid) {
    if (typeof getItemTags !== "function") {
      console.warn("STRK-52: getItemTags not available — skipping on-item removal walk");
    } else {
      const allTagCbs = container.querySelectorAll('input[name="numistaTag"]');
      const storedTags = getItemTags(_fillUuid);
      let didRemove = false;
      allTagCbs.forEach((cb) => {
        if (cb.dataset.onItem !== "1" || cb.checked) return;
        // Tag was on the item at render time but the user unchecked it — record opt-out.
        // Resolve stored-exact-case via case-insensitive search so removeItemTag() matches.
        const numistaLabel = (cb.dataset.tag || "").toLowerCase();
        const exactStored = storedTags.find((t) => t.toLowerCase() === numistaLabel);
        if (exactStored && typeof removeItemTag === "function") {
          removeItemTag(_fillUuid, exactStored); // internally calls addRemovedTag
          didRemove = true;
        }
      });
      if (didRemove && typeof window._renderEditTags === "function") window._renderEditTags();
    }
  }

  // Clear userModified for scalar fields the user chose to override.
  // Do NOT persist here — the save happens when the user confirms the edit modal.
  // If the user cancels, the next load restores the original in-memory state.
  if (_fillItem && _fillItem.fieldMeta) {
    checkboxes.forEach((cb) => {
      if (!cb.checked) return;
      if (
        USER_MODIFIED_TRACKED_FIELDS.has(cb.value) &&
        _fillItem.fieldMeta[cb.value]?.userModified
      ) {
        _fillItem.fieldMeta[cb.value].userModified = false;
      }
    });
  }

  // STRK-138: Reconcile Metal/Type exactly as a manual change would, so the
  // imported form lands identical to a correct manual entry (no re-selection).
  // Call handleTypeChange/filterTypesByMetal DIRECTLY (not via dispatched change
  // events) to avoid double-filtering / listener re-entrancy. Because we bypass
  // the metal-change listener, we explicitly mirror its spot-clear (STACK-49) —
  // but ONLY when handleTypeChange actually moves Metal (e.g. an imported Goldback
  // whose source metal was Silver -> Gold). When Metal is unchanged we preserve the
  // spot lookup, while a stale spot for the wrong metal can never persist.
  // Order matters: Type is the source of truth, so handleTypeChange() runs FIRST
  // (Type=Goldback/Silverback authoritatively coerces Metal + weight unit and
  // rebuilds the picker). filterTypesByMetal() runs AFTER, reading the now-updated
  // itemMetal.value, to mirror the manual sequence without its reset-guard clearing
  // the just-coerced Type (e.g. an imported Goldback whose source metal was wrong).
  const itemMetal = elements.itemMetal || safeGetElement("itemMetal");
  const itemType = elements.itemType || safeGetElement("itemType");
  const metalBefore = itemMetal instanceof HTMLElement ? itemMetal.value : null;
  if (typeof handleTypeChange === "function") handleTypeChange();
  const metalAfter = itemMetal instanceof HTMLElement ? itemMetal.value : null;
  if (metalAfter !== metalBefore && elements.itemSpotPrice instanceof HTMLElement) {
    elements.itemSpotPrice.value = "";
  }
  if (itemMetal instanceof HTMLElement && typeof filterTypesByMetal === "function") {
    filterTypesByMetal(itemMetal.value);
  }

  // STRK-138: For a Goldback, parse the imported denomination and select the
  // matching picker option. This MUST run after handleTypeChange rebuilt the
  // picker (updateDenomLabels) or the value would be overwritten. Silverback is
  // single-denomination — no fraction parse. Only override on an exact match;
  // an empty/unparseable denomination leaves the safe "1 Goldback" default.
  if (itemType instanceof HTMLElement && itemType.value === "Goldback") {
    const denomInput = container.querySelector('input[name="numistaFieldValue_denomination"]');
    const rawDenom = denomInput instanceof HTMLElement ? denomInput.value : "";
    const weight = parseGoldbackDenomination(rawDenom);
    if (weight !== null) {
      const gbDenomEl = elements.itemGbDenom || safeGetElement("itemGbDenom");
      if (gbDenomEl instanceof HTMLElement) gbDenomEl.value = String(weight);
    }
  }
};

/**
 * Close Numista results modal and clean up state
 */
const closeNumistaResultsModal = (opts) => {
  const modal = document.getElementById("numistaResultsModal");
  if (modal) modal.style.display = "none";
  selectedNumistaResult = null;
  const willClear = opts == null || opts.clearPendingSnapshot !== false;
  if (willClear) {
    window.pendingNumistaPickerSnapshot = null;
  }
};

/**
 * Renders Numista API usage progress bar into #numistaUsageBar
 * Reuses the same .api-usage / .usage-bar / .usage-text CSS as metals providers
 */
const renderNumistaUsageBar = () => {
  const container = document.getElementById("numistaUsageBar");
  if (!container) return;
  const usage = catalogConfig.getNumistaUsage();
  // Coerce to safe finite numbers and validate month format
  const used = Number.isFinite(usage.used) ? Math.max(0, usage.used) : 0;
  const quota = Number.isFinite(usage.quota) && usage.quota > 0 ? usage.quota : 2000;
  const month = /^\d{4}-\d{2}$/.test(usage.month) ? usage.month : "";
  const usedPercent = Math.min((used / quota) * 100, 100);
  const remainingPercent = 100 - usedPercent;
  const warning = used / quota >= 0.9;

  // Build DOM nodes safely (no innerHTML with localStorage-sourced values)
  container.textContent = "";
  const wrapper = document.createElement("div");
  wrapper.className = "api-usage";
  const bar = document.createElement("div");
  bar.className = "usage-bar";
  const usedDiv = document.createElement("div");
  usedDiv.className = "used";
  usedDiv.style.width = `${usedPercent}%`;
  const remainDiv = document.createElement("div");
  remainDiv.className = "remaining";
  remainDiv.style.width = `${remainingPercent}%`;
  bar.appendChild(usedDiv);
  bar.appendChild(remainDiv);
  const text = document.createElement("div");
  text.className = "usage-text";
  text.textContent = `${used}/${quota} calls${month ? ` (${month})` : ""}${warning ? " 🚩" : ""}`;
  wrapper.appendChild(bar);
  wrapper.appendChild(text);
  container.appendChild(wrapper);
};

/**
 * Renders PCGS API usage progress bar into #pcgsUsageBar
 * Clones the Numista pattern but uses daily granularity (1,000/day)
 */
const renderPcgsUsageBar = () => {
  const container = document.getElementById("pcgsUsageBar");
  if (!container) return;
  const usage = catalogConfig.getPcgsUsage();
  const used = Number.isFinite(usage.used) ? Math.max(0, usage.used) : 0;
  const quota = Number.isFinite(usage.limit) && usage.limit > 0 ? usage.limit : 1000;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(usage.date) ? usage.date : "";
  const usedPercent = Math.min((used / quota) * 100, 100);
  const remainingPercent = 100 - usedPercent;
  const warning = used / quota >= 0.9;

  container.textContent = "";
  const wrapper = document.createElement("div");
  wrapper.className = "api-usage";
  const bar = document.createElement("div");
  bar.className = "usage-bar";
  const usedDiv = document.createElement("div");
  usedDiv.className = "used";
  usedDiv.style.width = `${usedPercent}%`;
  const remainDiv = document.createElement("div");
  remainDiv.className = "remaining";
  remainDiv.style.width = `${remainingPercent}%`;
  bar.appendChild(usedDiv);
  bar.appendChild(remainDiv);
  const text = document.createElement("div");
  text.className = "usage-text";
  text.textContent = `${used}/${quota} calls${day ? ` (${day})` : ""}${warning ? " \uD83D\uDEA9" : ""}`;
  wrapper.appendChild(bar);
  wrapper.appendChild(text);
  container.appendChild(wrapper);
};

// =============================================================================
// Public surface (moved verbatim from js/catalog-api.js with the functions).
if (typeof window !== "undefined") {
  window.showNumistaResults = showNumistaResults;
  window.fillFormFromNumistaResult = fillFormFromNumistaResult;
  window.parseGoldbackDenomination = parseGoldbackDenomination;
  window.closeNumistaResultsModal = closeNumistaResultsModal;
  window.renderNumistaUsageBar = renderNumistaUsageBar;
  window.renderPcgsUsageBar = renderPcgsUsageBar;
}

// Modal event wiring (moved verbatim from the js/catalog-api.js DOMContentLoaded block).
document.addEventListener("DOMContentLoaded", function () {
  // =========================================================================
  // NUMISTA RESULTS MODAL — event wiring
  // =========================================================================

  const numistaResultsModal = document.getElementById("numistaResultsModal");
  const numistaResultsCloseBtn = document.getElementById("numistaResultsCloseBtn");
  const numistaFillCancelBtn = document.getElementById("numistaFillCancelBtn");
  const numistaFillBtn = document.getElementById("numistaFillBtn");
  const numistaResultsList = document.getElementById("numistaResultsList");

  // Close button
  if (numistaResultsCloseBtn) {
    numistaResultsCloseBtn.addEventListener("click", () =>
      closeNumistaResultsModal({ clearPendingSnapshot: true })
    );
  }

  // Cancel button in field picker
  if (numistaFillCancelBtn) {
    numistaFillCancelBtn.addEventListener("click", () =>
      closeNumistaResultsModal({ clearPendingSnapshot: true })
    );
  }

  // Fill Fields button
  if (numistaFillBtn) {
    numistaFillBtn.addEventListener("click", function () {
      // STRK-84: capture tag checkbox state BEFORE closeNumistaResultsModal
      // tears down the picker DOM. The snapshot is consumed by the Add-branch
      // submit handler in events.js after commitItemToInventory mints the UUID.
      const pickerContainer = document.getElementById("numistaFieldCheckboxes");
      if (pickerContainer && selectedNumistaResult) {
        const checked = [];
        const removed = [];
        pickerContainer.querySelectorAll('input[name="numistaTag"]').forEach((cb) => {
          if (cb.disabled) return;
          if (cb.checked) {
            checked.push(cb.dataset.tag);
          } else if (cb.dataset.userTouched === "1") {
            removed.push(cb.dataset.tag);
          }
        });
        window.pendingNumistaPickerSnapshot = {
          resultId: selectedNumistaResult.catalogId,
          checked,
          removed,
        };
      }

      if (selectedNumistaResult) {
        fillFormFromNumistaResult();

        // Fire-and-forget: cache metadata in IndexedDB
        if (
          window.imageCache?.isAvailable() &&
          selectedNumistaResult.catalogId &&
          window.featureFlags?.isEnabled("COIN_IMAGES")
        ) {
          imageCache
            .cacheMetadata(selectedNumistaResult.catalogId, selectedNumistaResult)
            .catch((e) => console.warn("Metadata cache failed:", e));
        }
      }
      closeNumistaResultsModal({ clearPendingSnapshot: editingIndex != null });

      // STRK-84: render preview tag chips in Add mode so the user sees
      // which Numista tags will be applied after submit
      const _addSnap = window.pendingNumistaPickerSnapshot;
      if (_addSnap && editingIndex == null) {
        const chipsEl = document.getElementById("itemModalTagsChips");
        if (chipsEl) {
          chipsEl.textContent = "";
          _addSnap.checked.forEach((tag) => {
            const chip = document.createElement("span");
            chip.className = "tag-chip";
            chip.textContent = tag;
            chip.title = "Pending Numista tag — applied on save";
            chipsEl.appendChild(chip);
          });
        }
      }
    });
  }

  // Click-sequence token: guards async handler against stale in-flight fetches
  // overwriting selectedNumistaResult when the user clicks multiple cards rapidly.
  let _numistaClickSeq = 0;

  // Delegated click on result cards → select and show field picker
  if (numistaResultsList) {
    numistaResultsList.addEventListener("click", async function (e) {
      const seq = ++_numistaClickSeq;

      // Let N# links open Numista without also selecting the row.
      const catalogLink = e.target.closest(".numista-result-id-link");
      if (catalogLink) {
        e.stopPropagation();
        return;
      }

      const results = numistaResultsList._numistaResults;
      const card = e.target.closest(".numista-result-card");
      if (!card) return;

      const index = parseInt(card.dataset.resultIndex, 10);
      if (!results || !results[index]) return;

      // Highlight selected card
      numistaResultsList
        .querySelectorAll(".numista-result-card")
        .forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");

      // Search results are lightweight — fetch full coin detail before populating
      // the field picker so Composition / Shape / Diameter / Orientation / Technique /
      // Edge Description / descriptions / tags are available. Falls back to the
      // search hit on failure to preserve partial-data UX. lookupItem() is cached.
      selectedNumistaResult = results[index];
      const detailCatalogId = selectedNumistaResult.catalogId;
      if (detailCatalogId) {
        const prevOpacity = card.style.opacity;
        card.style.opacity = "0.5";
        try {
          const detail = await catalogAPI.lookupItem(detailCatalogId);
          if (seq !== _numistaClickSeq) return;
          if (detail) selectedNumistaResult = detail;
        } catch (err) {
          if (seq !== _numistaClickSeq) return;
          console.warn("Numista detail fetch failed; using lightweight search result", err);
        } finally {
          card.style.opacity = prevOpacity;
        }
      }
      if (seq !== _numistaClickSeq) return;

      // Transition to field picker
      const preview = document.getElementById("numistaSelectedItem");
      const picker = document.getElementById("numistaFieldPicker");
      const title = document.getElementById("numistaResultsTitle");
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
      if (preview) preview.innerHTML = renderNumistaSelectedItem(selectedNumistaResult);
      renderNumistaFieldCheckboxes(selectedNumistaResult);
      if (numistaResultsList) numistaResultsList.style.display = "none";
      if (picker) picker.style.display = "block";
      if (title) title.textContent = "Fill Form Fields";
    });
  }

  // Background click dismiss
  if (numistaResultsModal) {
    numistaResultsModal.addEventListener("click", function (e) {
      if (e.target === numistaResultsModal) {
        closeNumistaResultsModal({ clearPendingSnapshot: true });
      }
    });
  }

  // ESC key handler — results modal has higher z-index, check it first
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      const resultsModal = document.getElementById("numistaResultsModal");
      if (resultsModal && resultsModal.style.display !== "none") {
        e.stopImmediatePropagation();
        closeNumistaResultsModal({ clearPendingSnapshot: true });
      }
    }
  });
});

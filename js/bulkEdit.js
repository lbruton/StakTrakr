/**
 * bulkEdit.js — Bulk Edit Tool
 *
 * Full-screen modal for selecting multiple inventory items and applying
 * field changes, copying, or deleting in bulk. Integrates with Numista
 * catalog lookup to populate field values.
 *
 * Selection uses item.serial (stable unique ID) — never array indices.
 */

// =============================================================================
// MODULE STATE
// =============================================================================

let bulkSelection = new Set(); // Set of item serial strings
let bulkFieldValues = {}; // { fieldId: value } for enabled fields
let bulkEnabledFields = new Set(); // Which field checkboxes are checked
let bulkSearchTerm = ""; // Current search/filter text
let bulkSearchTimer = null; // Debounce timer for search input
let bulkSortCol = null; // Column key to sort by, or null
let bulkSortDir = "asc"; // 'asc' | 'desc'

// Tracks blob URLs created for bulk image thumbnails so we can revoke them
// when the modal closes, preventing memory leaks.
const _bulkBlobUrls = new Set();

// Module-level matchMedia state for the field-panel breakpoint listener.
// Re-registering on every renderBulkFieldPanel call would leak listeners;
// instead we keep a single mql + handler pair and swap the handler on
// re-render so only one listener is ever active.
let _bulkMql = null;
let _bulkMqlHandler = null;

const BULK_COLUMN_PRIORITY = [
  "name",
  "metal",
  "composition",
  "numistaComposition",
  "type",
  "qty",
  "weight",
  "weightUnit",
  "numistaDiameter",
  "purity",
  "price",
  "marketValue",
  "spotPriceAtPurchase",
  "premiumPerOz",
  "totalPremium",
  "year",
  "grade",
  "gradingAuthority",
  "certNumber",
  "pcgsNumber",
  "serialNumber",
  "numistaId",
  "purchaseLocation",
  "storageLocation",
  "date",
  "notes",
  "collectable",
  "pcgsVerified",
  "obverseImageUrl",
  "reverseImageUrl",
  "serial",
  "uuid",
];

const BULK_COLUMN_LABEL_OVERRIDES = {
  qty: "Qty",
  composition: "Composition",
  marketValue: "Retail Price",
  spotPriceAtPurchase: "Spot At Purchase",
  premiumPerOz: "Premium / Oz",
  totalPremium: "Total Premium",
  gradingAuthority: "Grading Authority",
  certNumber: "Cert #",
  pcgsNumber: "PCGS #",
  numistaId: "Numista #",
  purchaseLocation: "Purchased At",
  storageLocation: "Storage Location",
  obverseImageUrl: "Obverse URL",
  reverseImageUrl: "Reverse URL",
  uuid: "UUID",
  numistaComposition: "Catalog Composition",
  numistaDiameter: "Diameter",
};

// Synthetic dot-path columns: stable flat `data-column` anchors that resolve
// to nested catalog fields. Keeps `data-column` selector-friendly while value
// lookup traverses nested data (AC-5).
const BULK_SYNTHETIC_COLUMN_PATHS = {
  numistaComposition: "numistaData.composition",
  numistaDiameter: "numistaData.diameter",
};

// Columns we never want surfaced as raw object/blob columns in the table.
// Their useful contents are exposed via synthetic dot-path columns above.
const BULK_COLUMN_SUPPRESSED_RAW = new Set(["numistaData"]);

// Nested storage map for bulk-edit fields. Fields listed here write through
// the dot-path on the item rather than as a top-level key. Top-level keys
// with the same id are NEVER created (STRK-91 AC-4).
const BULK_FIELD_STORAGE_MAP = {
  shape: "numistaData.shape",
};

// Apply a value to a possibly-nested dot-path on an item, initializing
// intermediate objects when needed.
const applyBulkFieldToItem = (item, fieldId, value) => {
  const path = BULK_FIELD_STORAGE_MAP[fieldId];
  if (!path) {
    item[fieldId] = value;
    return;
  }
  const parts = path.split(".");
  let cursor = item;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
};

const resolveBulkValue = (item, key) => {
  if (!item || !key) return undefined;
  const path = BULK_SYNTHETIC_COLUMN_PATHS[key] || key;
  if (path.indexOf(".") === -1) return item[path];
  const parts = path.split(".");
  let cursor = item;
  for (let i = 0; i < parts.length; i++) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = cursor[parts[i]];
  }
  return cursor;
};

const normalizeBulkValue = (value) => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeBulkValue(entry)).join(" ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }
  return String(value);
};

const getBulkTableDataKeys = () => {
  if (typeof inventory === "undefined" || !Array.isArray(inventory)) return [];
  const source =
    typeof getFilteredItems === "function" ? getFilteredItems(bulkSearchTerm) : inventory;
  const items = Array.isArray(source) && source.length ? source : inventory;
  const keySet = new Set();
  items.forEach((item) => {
    if (!item || typeof item !== "object") return;
    Object.keys(item).forEach((key) => {
      if (BULK_COLUMN_SUPPRESSED_RAW.has(key)) return;
      keySet.add(key);
    });
  });

  // Synthesize dot-path columns only when nested data is present on at least
  // one item in the visible/filtered set.
  Object.keys(BULK_SYNTHETIC_COLUMN_PATHS).forEach((syntheticKey) => {
    const hasValue = items.some((item) => {
      const v = resolveBulkValue(item, syntheticKey);
      return v !== undefined && v !== null && v !== "";
    });
    if (hasValue) keySet.add(syntheticKey);
  });

  const prioritized = BULK_COLUMN_PRIORITY.filter((key) => keySet.has(key));
  const remaining = [...keySet]
    .filter((key) => !BULK_COLUMN_PRIORITY.includes(key))
    .sort((a, b) => a.localeCompare(b));
  return [...prioritized, ...remaining];
};

const getBulkColumnLabel = (key) => {
  if (BULK_COLUMN_LABEL_OVERRIDES[key]) return BULK_COLUMN_LABEL_OVERRIDES[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getBulkSortableValue = (item, key) => {
  if (!item || !key) return "";
  return normalizeBulkValue(resolveBulkValue(item, key));
};

const formatBulkCellValue = (item, key) => {
  if (!item || !key) return "";
  const value = resolveBulkValue(item, key);
  if (value === null || value === undefined) return "";

  switch (key) {
    case "weight":
      return typeof formatWeight === "function"
        ? formatWeight(item.weight, item.weightUnit)
        : String(value);
    case "price":
    case "marketValue":
    case "spotPriceAtPurchase":
    case "premiumPerOz":
    case "totalPremium": {
      const numeric = Number(value);
      if (typeof formatCurrency === "function" && !Number.isNaN(numeric)) {
        return formatCurrency(numeric);
      }
      return String(value);
    }
    default:
      if (typeof value === "boolean") return value ? "true" : "false";
      if (Array.isArray(value)) return value.map((entry) => normalizeBulkValue(entry)).join(", ");
      if (typeof value === "object") return normalizeBulkValue(value);
      return String(value);
  }
};

// =============================================================================
// SEARCH FILTER HELPER
// =============================================================================

const getFilteredItems = (term) => {
  if (typeof inventory === "undefined" || !Array.isArray(inventory)) return [];
  const t = (term || "").toLowerCase().trim();
  if (!t) return inventory.slice();
  return inventory.filter((item) => {
    const tagText = typeof getItemTags === "function" ? getItemTags(item.uuid).join(" ") : "";
    // Searchable surface = the same key set we render: top-level keys minus
    // suppressed raw blobs, plus synthetic dot-path columns. Keeps display +
    // search + sort aligned (AC-5).
    const keys = Object.keys(item || {}).filter((key) => !BULK_COLUMN_SUPPRESSED_RAW.has(key));
    const syntheticKeys = Object.keys(BULK_SYNTHETIC_COLUMN_PATHS);
    const itemValues = [...keys, ...syntheticKeys].map((key) =>
      normalizeBulkValue(resolveBulkValue(item, key))
    );
    const searchText = [...itemValues, tagText]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
    return searchText.includes(t);
  });
};

// =============================================================================
// EDITABLE FIELDS DEFINITION
// =============================================================================

const BULK_EDITABLE_FIELDS = [
  { id: "name", label: "Name", inputType: "text" },
  {
    id: "metal",
    label: "Metal",
    inputType: "select",
    options: ["Silver", "Gold", "Platinum", "Palladium"],
  },
  {
    id: "type",
    label: "Type",
    inputType: "select",
    options: VALID_TYPES,
  },
  { id: "qty", label: "Quantity", inputType: "number", attrs: { min: "1", step: "1" } },
  { id: "weight", label: "Weight", inputType: "number", attrs: { min: "0", step: "0.001" } },
  {
    id: "weightUnit",
    label: "Weight Unit",
    inputType: "select",
    options: [
      { value: "oz", label: "ounce" },
      { value: "g", label: "gram" },
      { value: "kg", label: "kilogram" },
      { value: "lb", label: "pound" },
      { value: "gb", label: "goldback" },
      { value: "sb", label: "silverback" },
    ],
  },
  {
    id: "purity",
    label: "Purity",
    inputType: "select",
    options: [
      { value: "1.0", label: "100% — Pure" },
      { value: "0.9999", label: ".9999 — Four Nines" },
      { value: "0.9995", label: ".9995 — 99.95%" },
      { value: "0.999", label: ".999 — Fine" },
      { value: "0.925", label: ".925 — Sterling" },
      { value: "0.500", label: ".500 — 12K" },
      { value: "0.9167", label: ".9167 — 22K" },
      { value: "0.900", label: ".900 — 90%" },
      { value: "0.800", label: ".800 — 80%" },
      { value: "0.600", label: ".600 — 60%" },
      { value: "0.400", label: ".400 — 40%" },
      { value: "0.350", label: ".350 — 35%" },
      { value: "custom", label: "Custom…" },
    ],
  },
  { id: "price", label: "Purchase Price", inputType: "number", attrs: { min: "0", step: "0.01" } },
  {
    id: "marketValue",
    label: "Retail Price",
    inputType: "number",
    attrs: { min: "0", step: "0.01" },
  },
  { id: "year", label: "Year", inputType: "text" },
  {
    id: "grade",
    label: "Grade",
    inputType: "select",
    options: [
      { value: "", label: "-- None --" },
      { value: "AG", label: "AG - About Good" },
      { value: "G", label: "G - Good" },
      { value: "VG", label: "VG - Very Good" },
      { value: "F", label: "F - Fine" },
      { value: "VF", label: "VF - Very Fine" },
      { value: "XF", label: "XF - Extremely Fine" },
      { value: "AU", label: "AU - About Uncirculated" },
      { value: "UNC", label: "UNC - Uncirculated" },
      { value: "BU", label: "BU - Brilliant Uncirculated" },
      { value: "MS-60", label: "MS-60" },
      { value: "MS-61", label: "MS-61" },
      { value: "MS-62", label: "MS-62" },
      { value: "MS-63", label: "MS-63" },
      { value: "MS-64", label: "MS-64" },
      { value: "MS-65", label: "MS-65" },
      { value: "MS-66", label: "MS-66" },
      { value: "MS-67", label: "MS-67" },
      { value: "MS-68", label: "MS-68" },
      { value: "MS-69", label: "MS-69" },
      { value: "MS-70", label: "MS-70" },
      { value: "PF-60", label: "PF-60" },
      { value: "PF-61", label: "PF-61" },
      { value: "PF-62", label: "PF-62" },
      { value: "PF-63", label: "PF-63" },
      { value: "PF-64", label: "PF-64" },
      { value: "PF-65", label: "PF-65" },
      { value: "PF-66", label: "PF-66" },
      { value: "PF-67", label: "PF-67" },
      { value: "PF-68", label: "PF-68" },
      { value: "PF-69", label: "PF-69" },
      { value: "PF-70", label: "PF-70" },
    ],
  },
  {
    id: "gradingAuthority",
    label: "Grading Auth",
    inputType: "select",
    options: [
      { value: "", label: "-- None --" },
      { value: "PCGS", label: "PCGS" },
      { value: "NGC", label: "NGC" },
      { value: "ANACS", label: "ANACS" },
      { value: "ICG", label: "ICG" },
    ],
  },
  { id: "certNumber", label: "Cert #", inputType: "text" },
  { id: "pcgsNumber", label: "PCGS Number", inputType: "text" },
  {
    id: "paymentMethod",
    label: "Payment Method",
    inputType: "select",
    options: [
      "",
      "Zelle",
      "PayPal",
      "Credit Card",
      "Debit Card",
      "Cash",
      "Check",
      "Wire",
      "Crypto",
      "Other",
    ],
  },
  { id: "purchaseLocation", label: "Purchase Loc", inputType: "text" },
  { id: "storageLocation", label: "Storage Loc", inputType: "text" },
  { id: "date", label: "Purchase Date", inputType: "date" },
  { id: "serialNumber", label: "Serial Number", inputType: "text" },
  { id: "notes", label: "Notes", inputType: "textarea" },
  {
    id: "shape",
    label: "Shape",
    inputType: "select",
    options: [
      { value: "round", label: "Round" },
      { value: "rectangular", label: "Rectangular" },
      { value: "square", label: "Square" },
      { value: "oval", label: "Oval" },
      { value: "other", label: "Other" },
    ],
  },
  { id: "capsule", label: "Capsule", inputType: "text" },
  { id: "capsuleNotes", label: "Capsule Notes", inputType: "text" },
  { id: "numistaId", label: "Numista #", inputType: "text" },
  {
    id: "obverseImageUrl",
    label: "Obverse URL",
    inputType: "text",
    attrs: { placeholder: "https://example.com/obverse.jpg" },
  },
  {
    id: "reverseImageUrl",
    label: "Reverse URL",
    inputType: "text",
    attrs: { placeholder: "https://example.com/reverse.jpg" },
  },
];

// =============================================================================
// OPEN / CLOSE
// =============================================================================

const openBulkEdit = () => {
  const modal = safeGetElement("bulkEditModal");
  if (!modal) return;

  // Always start with a clean selection (STACK-55)
  bulkSelection = new Set();

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";

  renderBulkFieldPanel();
  renderBulkTable();
  renderBulkFooter();

  // Focus search input after render
  const searchInput = safeGetElement("bulkEditSearch");
  if (searchInput) searchInput.focus();
};

const closeBulkEdit = () => {
  const modal = safeGetElement("bulkEditModal");
  if (!modal) return;

  // Clear Numista callback
  window._bulkEditNumistaCallback = null;

  // Revoke all blob URLs created for thumbnails to free memory
  _bulkBlobUrls.forEach((u) => {
    try {
      URL.revokeObjectURL(u);
    } catch (e) {
      /* ignore */
    }
  });
  _bulkBlobUrls.clear();

  modal.style.display = "none";
  document.body.style.overflow = "";
};

// =============================================================================
// HELPER FACTORIES
// =============================================================================

/**
 * Creates the appropriate input element for a bulk edit field definition.
 * @param {Object} field - Field definition from BULK_EDITABLE_FIELDS
 * @returns {HTMLElement} The input/select/textarea element
 */
const createFieldInput = (field) => {
  let input;
  if (field.inputType === "select") {
    input = document.createElement("select");
    field.options.forEach((opt) => {
      const option = document.createElement("option");
      if (typeof opt === "object" && opt !== null) {
        option.value = opt.value;
        option.textContent = opt.label;
      } else {
        option.value = opt;
        option.textContent = opt;
      }
      input.appendChild(option);
    });
  } else if (field.inputType === "textarea") {
    input = document.createElement("textarea");
    input.rows = 2;
  } else {
    input = document.createElement("input");
    input.type = field.inputType;
    if (field.attrs) {
      Object.keys(field.attrs).forEach((k) => input.setAttribute(k, field.attrs[k]));
    }
  }
  input.className = "field-input";
  input.id = "bulkFieldVal_" + field.id;
  return input;
};

/** Coercion rules: fieldId → (rawValue) => coerced value */
const FIELD_COERCIONS = {
  qty: (v) => {
    const n = parseInt(v, 10);
    return isNaN(n) || n < 1 ? 1 : n;
  },
  weight: (v) => {
    const n = parseFloat(v);
    return isNaN(n) || n < 0 ? 0 : n;
  },
  price: (v) => {
    const n = parseFloat(v);
    return isNaN(n) || n < 0 ? 0 : n;
  },
  marketValue: (v) => {
    const n = parseFloat(v);
    return isNaN(n) || n < 0 ? 0 : n;
  },
  purity: (v) => {
    const n = parseFloat(v);
    return isNaN(n) || n <= 0 || n > 1 ? 1.0 : n;
  },
};

/**
 * Coerces a bulk edit field value to the correct type based on field ID.
 * @param {string} fieldId - The field identifier
 * @param {string} value - The raw string value from the input
 * @returns {*} The coerced value
 */
const coerceFieldValue = (fieldId, value) => {
  const coerce = FIELD_COERCIONS[fieldId];
  if (coerce) return coerce(value);
  return typeof value === "string" ? sanitizeHtml(value) : value;
};

/**
 * Builds a table row element for a single inventory item in the bulk edit table.
 * @param {Object} item - The inventory item
 * @param {boolean} isPinned - Whether the row is in the pinned section
 * @returns {HTMLTableRowElement} The constructed row
 */
const buildBulkItemRow = (item, isPinned, dataColumns) => {
  const serial = String(item.serial);
  const tr = document.createElement("tr");
  tr.setAttribute("data-serial", serial);
  const isSelected = bulkSelection.has(serial);
  if (isSelected) tr.classList.add("bulk-edit-selected");
  if (isPinned) tr.classList.add("bulk-edit-pinned");

  // Row click toggles selection
  tr.addEventListener("click", (e) => {
    if (e.target.type === "checkbox") return;
    toggleItemSelection(serial);
  });

  // Checkbox cell
  const cbTd = document.createElement("td");
  cbTd.setAttribute("data-column", "cb");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = isSelected;
  cb.addEventListener("change", () => toggleItemSelection(serial));
  cbTd.appendChild(cb);
  // Forward clicks that land on the ::before tap-target expansion (44×44px
  // pseudo-element) to the checkbox. The row-level click handler already
  // covers most of this, but the explicit forward here ensures the checkbox
  // receives the event even when e.target is cbTd itself.
  cbTd.addEventListener("click", (e) => {
    if (e.target !== cb) cb.click();
  });
  if (isPinned) {
    const pin = document.createElement("span");
    pin.className = "bulk-pin-icon";
    pin.title = "Pinned selection";
    pin.setAttribute("role", "img");
    pin.setAttribute("aria-label", "Pinned");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M14 4v5c0 1.12.37 2.16 1 3H9c.63-.84 1-1.88 1-3V4h4m3-2H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3V4h1c.55 0 1-.45 1-1s-.45-1-1-1z"
    );
    svg.appendChild(path);
    pin.appendChild(svg);
    cbTd.appendChild(pin);
  }
  tr.appendChild(cbTd);

  // Image thumbnail cell — resolved async from IDB after row is appended
  const imgTd = document.createElement("td");
  imgTd.className = "bulk-img-cell";
  imgTd.setAttribute("data-column", "img");
  // Placeholder pair shown until IDB resolves
  imgTd.innerHTML = '<span class="bulk-img-placeholder" data-side="obverse"></span>';
  // Store item identity for the async loader and upload popover
  imgTd.dataset.uuid = item.uuid || "";
  imgTd.dataset.numistaId = item.numistaId || "";
  imgTd.dataset.itemName = item.name || "";
  imgTd.dataset.serial = serial;
  imgTd.title = "Click to manage photos";
  imgTd.style.cursor = "pointer";
  imgTd.addEventListener("click", (e) => {
    e.stopPropagation();
    _openBulkImagePopover(imgTd, item);
  });
  tr.appendChild(imgTd);

  // Data cells
  const addCell = (text, columnKey) => {
    const td = document.createElement("td");
    td.setAttribute("data-column", columnKey);
    td.textContent = text || "";
    td.title = text || "";
    tr.appendChild(td);
  };

  dataColumns.forEach((column) => {
    addCell(formatBulkCellValue(item, column.key), column.key);
  });

  return tr;
};

// =============================================================================
// FIELD PANEL (left side)
// =============================================================================

/**
 * Builds the collapsible field-panel scaffold (details/summary/content) and
 * wires the ARIA-expanded sync (STRK-91 C.4). Appends the scaffold into the
 * panel and returns the live node references the caller needs.
 * @param {HTMLElement} panel - The #bulkEditFieldPanel container
 * @returns {{details: HTMLElement, summary: HTMLElement, content: HTMLElement,
 *   summaryCount: HTMLElement, syncAria: function, formatCountText: function}}
 */
const buildBulkFieldPanelScaffold = (panel) => {
  // Wrap heading + hint + field rows in <details>/<summary>. Wide viewports
  // (>768px) get `open` forced via matchMedia listener; narrow viewports start
  // collapsed so the right-hand item table is reachable without scrolling past
  // the entire field list.
  const details = document.createElement("details");
  details.className = "bulk-edit-fields-details";
  details.id = "bulkEditFieldPanelDetails";

  const summary = document.createElement("summary");
  summary.className = "bulk-edit-fields-summary";
  // Stable structure: "Fields to Update — <count> enabled". The count node is
  // updated in place on checkbox toggle (single text-node mutation, no full
  // re-render).
  const summaryLabel = document.createElement("span");
  summaryLabel.className = "bulk-edit-fields-summary-label";
  summaryLabel.textContent = "Fields to Update";
  summary.appendChild(summaryLabel);

  const summaryCount = document.createElement("span");
  summaryCount.className = "bulk-edit-fields-summary-count";
  summaryCount.id = "bulkEditFieldPanelCount";
  summaryCount.setAttribute("aria-live", "polite");
  summaryCount.setAttribute("aria-atomic", "true");
  const formatCountText = (n) => `${n} enabled`;
  summaryCount.textContent = formatCountText(bulkEnabledFields.size);
  summary.appendChild(summaryCount);

  details.appendChild(summary);

  // Content wrapper (children scroll within the panel).
  const content = document.createElement("div");
  content.className = "bulk-edit-fields-content";
  content.id = "bulkEditFieldPanelContent";

  const hint = document.createElement("p");
  hint.className = "bulk-edit-fields-hint";
  hint.textContent = "Check a field to enable it, then set the value to apply.";
  content.appendChild(hint);

  details.appendChild(content);
  panel.appendChild(details);

  // ARIA wiring: <summary> already toggles `open`; mirror state into
  // aria-expanded/aria-controls for AT clarity and keep in sync on toggle.
  summary.setAttribute("aria-controls", "bulkEditFieldPanelContent");
  const syncAria = () => {
    summary.setAttribute("aria-expanded", details.open ? "true" : "false");
  };
  syncAria();
  details.addEventListener("toggle", syncAria);

  return { details, summary, content, summaryCount, syncAria, formatCountText };
};

/**
 * Wires the responsive breakpoint behavior for the field panel: force-open on
 * wide viewports, collapsed-by-default on narrow, re-evaluated when crossing the
 * 768px boundary. Reuses module-level _bulkMql / _bulkMqlHandler so re-renders
 * swap the listener instead of stacking new ones.
 * @param {HTMLElement} details - The <details> element to toggle
 * @param {HTMLElement} summary - The <summary> element (tracks user clicks)
 * @param {function} syncAria - Callback to mirror open-state into aria-expanded
 * @returns {void}
 */
const wireBulkFieldPanelBreakpoint = (details, summary, syncAria) => {
  if (!_bulkMql && typeof window !== "undefined" && typeof window.matchMedia === "function") {
    _bulkMql = window.matchMedia("(max-width: 768px)");
  }
  const mql = _bulkMql;
  const applyBreakpoint = () => {
    const isNarrow = mql ? mql.matches : false;
    if (isNarrow) {
      // Leave whatever the user toggled if they've interacted; only force the
      // initial collapsed state on first render.
      if (!details.dataset.userToggled) {
        details.open = false;
      }
    } else {
      details.open = true;
    }
    syncAria();
  };
  // Track explicit user interaction so a resize doesn't clobber their choice.
  summary.addEventListener("click", () => {
    details.dataset.userToggled = "1";
  });
  applyBreakpoint();
  if (mql) {
    // Remove the previous handler before registering the new one so each
    // renderBulkFieldPanel call does not stack an additional listener.
    if (_bulkMqlHandler) {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", _bulkMqlHandler);
      } else if (typeof mql.removeListener === "function") {
        mql.removeListener(_bulkMqlHandler);
      }
    }
    _bulkMqlHandler = () => applyBreakpoint();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", _bulkMqlHandler);
    } else if (typeof mql.addListener === "function") {
      mql.addListener(_bulkMqlHandler);
    }
  }
};

/**
 * Builds and appends a checkbox/label/input row for a single editable field
 * into the content wrapper, wiring enable-toggle and value-tracking listeners.
 * @param {Object} field - Field definition from BULK_EDITABLE_FIELDS
 * @param {HTMLElement} content - The content wrapper to append the row into
 * @param {function} updateFieldCount - Callback to refresh the enabled count
 * @returns {void}
 */
const appendBulkFieldRow = (field, content, updateFieldCount) => {
  const row = document.createElement("div");
  row.className = "bulk-edit-field-row";

  // Checkbox
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = "bulkField_" + field.id;
  cb.checked = bulkEnabledFields.has(field.id);

  // Label
  const lbl = document.createElement("label");
  lbl.setAttribute("for", "bulkField_" + field.id);
  lbl.textContent = field.label;

  // Input
  const input = createFieldInput(field);
  input.disabled = !bulkEnabledFields.has(field.id);

  // Restore persisted value
  if (bulkFieldValues[field.id] !== undefined) {
    input.value = bulkFieldValues[field.id];
  }

  // Checkbox toggle — also re-renders footer to update Apply button disabled state
  cb.addEventListener("change", () => {
    if (cb.checked) {
      bulkEnabledFields.add(field.id);
      input.disabled = false;
      input.focus();
    } else {
      bulkEnabledFields.delete(field.id);
      input.disabled = true;
    }
    updateFieldCount();
    renderBulkFooter();
  });

  // Track value changes
  input.addEventListener("input", () => {
    bulkFieldValues[field.id] = input.value;
  });
  input.addEventListener("change", () => {
    bulkFieldValues[field.id] = input.value;
  });

  row.appendChild(cb);
  row.appendChild(lbl);
  row.appendChild(input);
  content.appendChild(row);
};

/**
 * Wires the goldback/silverback denomination picker swap for the bulk weight
 * field, mirroring the main item modal. Builds a hidden denomination <select>,
 * swaps it in when goldback mode is active, and keeps type/metal/unit selects in
 * sync. No-op when prerequisites (weight inputs, GOLDBACK_DENOMINATIONS) are
 * missing.
 * @param {HTMLElement} panel - The #bulkEditFieldPanel container (for label lookup)
 * @returns {void}
 */
const wireBulkWeightDenomPicker = (panel) => {
  const bwInput = safeGetElement("bulkFieldVal_weight");
  const bwUnitSelect = safeGetElement("bulkFieldVal_weightUnit");
  const bwLabel = panel.querySelector('label[for="bulkField_weight"]');
  const bwCheckbox = safeGetElement("bulkField_weight");

  if (!(bwInput && bwUnitSelect && typeof GOLDBACK_DENOMINATIONS !== "undefined")) return;

  // Build hidden denomination select
  const denomSelect = document.createElement("select");
  denomSelect.className = "field-input";
  denomSelect.id = "bulkFieldVal_weightDenom";
  denomSelect.style.display = "none";
  denomSelect.disabled = bwInput.disabled;

  GOLDBACK_DENOMINATIONS.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = String(d.weight);
    opt.textContent = d.label;
    denomSelect.appendChild(opt);
  });

  // Insert right after weight input in the same row
  bwInput.parentNode.insertBefore(denomSelect, bwInput.nextSibling);

  // Restore persisted value
  if (bulkFieldValues["weight"] !== undefined) {
    denomSelect.value = String(bulkFieldValues["weight"]);
  }

  // Track denomination changes → update weight field value
  denomSelect.addEventListener("change", () => {
    bulkFieldValues["weight"] = denomSelect.value;
  });

  const bulkTypeSelect = document.getElementById("bulkFieldVal_type");
  const bulkMetalSelect = safeGetElement("bulkFieldVal_metal");

  // Swap function
  const toggleBulkGbPicker = () => {
    const isSb = bwUnitSelect.value === "sb" || bulkTypeSelect?.value === "Silverback";
    const isGb = bwUnitSelect.value === "gb" && !isSb;
    bwInput.style.display = isGb ? "none" : "";
    denomSelect.style.display = isGb ? "" : "none";
    if (bwLabel) bwLabel.textContent = isGb ? "DENOMINATION" : "Weight";
    if (isGb) {
      denomSelect.disabled = bwInput.disabled;
      bulkFieldValues["weight"] = denomSelect.value;
    }
  };

  const updateBulkDenomLabels = () => {
    while (denomSelect.firstChild) denomSelect.removeChild(denomSelect.firstChild);
    GOLDBACK_DENOMINATIONS.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = String(d.weight);
      opt.textContent = d.label;
      if (d.weight === 1) opt.selected = true;
      denomSelect.appendChild(opt);
    });
  };

  const filterBulkTypesByMetal = (metalValue) => {
    if (!bulkTypeSelect || typeof TYPE_METAL_FILTER === "undefined") return;
    Array.from(bulkTypeSelect.options).forEach((option) => {
      const allowedMetals = TYPE_METAL_FILTER[option.value];
      const isAllowed = !Array.isArray(allowedMetals) || allowedMetals.includes(metalValue);
      option.hidden = !isAllowed;
      option.disabled = !isAllowed;
    });

    const selectedOption = bulkTypeSelect.options[bulkTypeSelect.selectedIndex];
    if (selectedOption && selectedOption.hidden) {
      bulkTypeSelect.value = "Coin";
      handleBulkTypeChange();
    }
  };

  const handleBulkTypeChange = () => {
    if (!bulkTypeSelect) return;
    const typeValue = bulkTypeSelect.value;
    const isGoldbackType = typeValue === "Goldback";
    const isSilverbackType = typeValue === "Silverback";

    if (isGoldbackType) {
      bwUnitSelect.value = "gb";
      bulkFieldValues["weightUnit"] = "gb";
      updateBulkDenomLabels();
    } else if (isSilverbackType) {
      bwUnitSelect.value = "sb";
      bulkFieldValues["weightUnit"] = "sb";
    } else if (bwUnitSelect.value === "gb" || bwUnitSelect.value === "sb") {
      bwUnitSelect.value = "oz";
      bulkFieldValues["weightUnit"] = "oz";
    }

    toggleBulkGbPicker();
  };

  // Listen for unit changes
  bwUnitSelect.addEventListener("change", () => {
    if (bulkTypeSelect?.value === "Silverback") {
      bwUnitSelect.value = "sb";
      bulkFieldValues["weightUnit"] = "sb";
    }
    toggleBulkGbPicker();
  });

  if (bulkMetalSelect) {
    bulkMetalSelect.addEventListener("change", () => {
      filterBulkTypesByMetal(bulkMetalSelect.value);
      handleBulkTypeChange();
    });
  }

  if (bulkTypeSelect) {
    bulkTypeSelect.addEventListener("change", () => {
      handleBulkTypeChange();
    });
  }

  // Sync disabled state when weight checkbox toggles
  if (bwCheckbox) {
    bwCheckbox.addEventListener("change", () => {
      denomSelect.disabled = !bwCheckbox.checked;
    });
  }

  // Initialize state (e.g. if weightUnit was persisted as 'gb' or 'sb')
  if (bulkFieldValues["weightUnit"] === "gb" || bulkFieldValues["weightUnit"] === "sb") {
    bwUnitSelect.value = bulkFieldValues["weightUnit"];
    toggleBulkGbPicker();
  }

  if (bulkMetalSelect) {
    filterBulkTypesByMetal(bulkMetalSelect.value);
  }
  if (bulkTypeSelect) {
    handleBulkTypeChange();
  }
};

/**
 * Wires the custom-purity input behavior for the bulk purity field, matching the
 * inventory modal pattern. Inserts a hidden number input that surfaces when the
 * purity select is "custom", restores persisted custom values, and keeps
 * bulkFieldValues.purity in sync. No-op when the purity select is absent.
 * @returns {void}
 */
const wireBulkPurityCustom = () => {
  const puritySelect = safeGetElement("bulkFieldVal_purity");
  const purityCheckbox = safeGetElement("bulkField_purity");
  if (!puritySelect) return;

  const purityCustomInput = document.createElement("input");
  purityCustomInput.type = "number";
  purityCustomInput.id = "bulkFieldVal_purityCustom";
  purityCustomInput.className = "field-input";
  purityCustomInput.min = "0.001";
  purityCustomInput.max = "1";
  purityCustomInput.step = "0.0001";
  purityCustomInput.placeholder = "e.g. 0.9995";
  purityCustomInput.setAttribute("aria-label", "Custom purity");
  purityCustomInput.style.display = "none";
  purityCustomInput.disabled = puritySelect.disabled;
  puritySelect.parentNode.insertBefore(purityCustomInput, puritySelect.nextSibling);

  const optionValues = new Set(Array.from(puritySelect.options).map((option) => option.value));
  const savedPurity = bulkFieldValues.purity;
  if (savedPurity !== undefined) {
    const savedPurityStr = String(savedPurity);
    if (optionValues.has(savedPurityStr) && savedPurityStr !== "custom") {
      puritySelect.value = savedPurityStr;
    } else {
      puritySelect.value = "custom";
      purityCustomInput.value = savedPurityStr;
    }
  }

  const syncPurityState = () => {
    const isCustom = puritySelect.value === "custom";
    purityCustomInput.style.display = isCustom ? "" : "none";
    purityCustomInput.disabled = puritySelect.disabled || !isCustom;
    if (isCustom) {
      bulkFieldValues.purity = purityCustomInput.value;
    } else {
      bulkFieldValues.purity = puritySelect.value;
    }
  };

  puritySelect.addEventListener("change", syncPurityState);
  purityCustomInput.addEventListener("input", () => {
    bulkFieldValues.purity = purityCustomInput.value;
  });
  purityCustomInput.addEventListener("change", () => {
    bulkFieldValues.purity = purityCustomInput.value;
  });

  if (purityCheckbox) {
    purityCheckbox.addEventListener("change", () => {
      syncPurityState();
    });
  }

  syncPurityState();
};

const renderBulkFieldPanel = () => {
  const panel = safeGetElement("bulkEditFieldPanel");
  if (!panel) return;

  // Clear existing content
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  // STRK-91 C.4: collapsible mobile field panel scaffold + ARIA wiring.
  const { details, summary, content, summaryCount, syncAria, formatCountText } =
    buildBulkFieldPanelScaffold(panel);

  wireBulkFieldPanelBreakpoint(details, summary, syncAria);

  // Field-count update helper (single text-node mutation per toggle).
  const updateFieldCount = () => {
    summaryCount.textContent = formatCountText(bulkEnabledFields.size);
  };

  // Build field rows (appended into the <details> content wrapper).
  BULK_EDITABLE_FIELDS.forEach((field) => {
    appendBulkFieldRow(field, content, updateFieldCount);
  });

  // Wire up denomination picker swap for weight field (mirrors main modal)
  wireBulkWeightDenomPicker(panel);

  // Wire up custom purity input behavior (matches inventory modal pattern)
  wireBulkPurityCustom();
};

// =============================================================================
// ITEM TABLE (right side)
// =============================================================================

/**
 * Renders the toolbar (search, buttons, badge) — called once on open.
 * The toolbar persists across search/selection updates.
 */
const renderBulkToolbar = () => {
  const toolbar = safeGetElement("bulkEditToolbar");
  if (!toolbar) return;

  while (toolbar.firstChild) toolbar.removeChild(toolbar.firstChild);

  // Numista Lookup button (left of search)
  if (typeof catalogAPI !== "undefined") {
    const numistaBtn = document.createElement("button");
    numistaBtn.type = "button";
    numistaBtn.className = "bulk-edit-numista-btn";
    numistaBtn.textContent = "Numista Lookup";
    numistaBtn.title = "Search Numista catalog and fill field values";
    numistaBtn.addEventListener("click", triggerBulkNumistaLookup);
    toolbar.appendChild(numistaBtn);
  }

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.id = "bulkEditSearch";
  searchInput.placeholder = "Search items...";
  searchInput.value = bulkSearchTerm || "";
  searchInput.addEventListener("input", () => {
    // Debounce: wait 250ms after last keystroke before filtering
    if (bulkSearchTimer) clearTimeout(bulkSearchTimer);
    bulkSearchTimer = setTimeout(() => {
      bulkSearchTerm = searchInput.value;
      renderBulkTableBody();
    }, 250);
  });
  toolbar.appendChild(searchInput);

  const selectAllBtn = document.createElement("button");
  selectAllBtn.type = "button";
  selectAllBtn.id = "bulkSelectAllBtn";
  selectAllBtn.className = "btn secondary";
  selectAllBtn.textContent = "Select All";
  selectAllBtn.addEventListener("click", () => selectAllItems(true));
  toolbar.appendChild(selectAllBtn);

  const selectNoneBtn = document.createElement("button");
  selectNoneBtn.type = "button";
  selectNoneBtn.id = "bulkSelectNoneBtn";
  selectNoneBtn.className = "btn secondary";
  selectNoneBtn.textContent = "Select None";
  selectNoneBtn.addEventListener("click", () => selectAllItems(false));
  toolbar.appendChild(selectNoneBtn);

  const badge = document.createElement("span");
  badge.className = "bulk-edit-count-badge";
  badge.id = "bulkEditCountBadge";
  badge.textContent = bulkSelection.size + " selected";
  toolbar.appendChild(badge);
};

/**
 * Renders the table body (rows) — called on search, selection, and data changes.
 * Does NOT touch the toolbar, preserving search input focus.
 */
const renderBulkTableBody = () => {
  const wrap = safeGetElement("bulkEditTableWrap");
  if (!wrap) return;

  while (wrap.firstChild) wrap.removeChild(wrap.firstChild);

  if (typeof inventory === "undefined" || !Array.isArray(inventory) || inventory.length === 0) {
    const empty = document.createElement("p");
    empty.style.cssText = "padding:2rem;text-align:center;color:var(--text-secondary);";
    empty.textContent = "No inventory items found.";
    wrap.appendChild(empty);
    return;
  }

  // Filter by search term
  const filtered = getFilteredItems(bulkSearchTerm);
  const term = (bulkSearchTerm || "").toLowerCase().trim();

  // Compute pinned items — selected items NOT in search results (only when search active)
  let pinnedItems = [];
  if (term) {
    const filteredSerials = new Set(filtered.map((i) => String(i.serial)));
    pinnedItems = inventory.filter(
      (item) => bulkSelection.has(String(item.serial)) && !filteredSerials.has(String(item.serial))
    );
  }

  const table = document.createElement("table");
  table.className = "bulk-edit-table";

  const dataColumns = getBulkTableDataKeys().map((key) => ({
    key,
    label: getBulkColumnLabel(key),
  }));

  if (bulkSortCol && !dataColumns.some((column) => column.key === bulkSortCol)) {
    bulkSortCol = null;
  }

  // Column definitions
  const columns = [
    { key: "cb", label: "", nosort: true },
    { key: "img", label: "Img", nosort: true },
    ...dataColumns,
  ];
  const colCount = columns.length;

  // Sort filtered items (preserves original array for selection state checks)
  const sortedFiltered = bulkSortCol
    ? [...filtered].sort((a, b) => {
        const av = getBulkSortableValue(a, bulkSortCol);
        const bv = getBulkSortableValue(b, bulkSortCol);
        const numA = Number(av);
        const numB = Number(bv);
        const bothNumeric = av !== "" && bv !== "" && !Number.isNaN(numA) && !Number.isNaN(numB);
        const cmp = bothNumeric
          ? numA - numB
          : String(av).localeCompare(String(bv), undefined, {
              numeric: true,
              sensitivity: "base",
            });
        return bulkSortDir === "asc" ? cmp : -cmp;
      })
    : filtered;

  // Master checkbox state (based on filtered items only, excludes pinned)
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((item) => bulkSelection.has(String(item.serial)));
  const someFilteredSelected =
    !allFilteredSelected && filtered.some((item) => bulkSelection.has(String(item.serial)));

  // Thead
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  columns.forEach((col) => {
    const th = document.createElement("th");
    th.setAttribute("data-column", col.key);
    if (col.key === "cb") {
      const masterCb = document.createElement("input");
      masterCb.type = "checkbox";
      masterCb.title = "Toggle all visible";
      masterCb.checked = allFilteredSelected;
      masterCb.indeterminate = someFilteredSelected;
      masterCb.addEventListener("change", () => selectAllItems(masterCb.checked));
      th.appendChild(masterCb);
    } else if (col.nosort) {
      th.textContent = col.label;
    } else {
      th.textContent = col.label;
      th.classList.add("bulk-sortable");
      if (bulkSortCol === col.key) {
        th.classList.add(bulkSortDir === "asc" ? "sort-asc" : "sort-desc");
      }
      th.addEventListener("click", () => {
        if (bulkSortCol === col.key) {
          bulkSortDir = bulkSortDir === "asc" ? "desc" : "asc";
        } else {
          bulkSortCol = col.key;
          bulkSortDir = "asc";
        }
        renderBulkTableBody();
      });
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Tbody
  const tbody = document.createElement("tbody");

  // Pinned section (selected items not matching current search)
  if (pinnedItems.length > 0) {
    // Section header
    const headerTr = document.createElement("tr");
    headerTr.className = "bulk-edit-pinned-header";
    const headerTd = document.createElement("td");
    headerTd.colSpan = colCount;
    headerTd.textContent = "Pinned selections (" + pinnedItems.length + ")";
    headerTr.appendChild(headerTd);
    tbody.appendChild(headerTr);

    // Pinned rows
    pinnedItems.forEach((item) => {
      tbody.appendChild(buildBulkItemRow(item, true, dataColumns));
    });

    // Divider
    const divTr = document.createElement("tr");
    divTr.className = "bulk-edit-pinned-divider";
    const divTd = document.createElement("td");
    divTd.colSpan = colCount;
    divTr.appendChild(divTd);
    tbody.appendChild(divTr);
  }

  // Filtered rows (sorted)
  sortedFiltered.forEach((item) => {
    tbody.appendChild(buildBulkItemRow(item, false, dataColumns));
  });

  table.appendChild(tbody);
  wrap.appendChild(table);

  // Update badge count
  const badge = safeGetElement("bulkEditCountBadge");
  if (badge) badge.textContent = bulkSelection.size + " selected";

  // Async-load images for all rows now that they are in the DOM
  const allRows = [...pinnedItems, ...sortedFiltered];
  allRows.forEach((item) => {
    const tr = tbody.querySelector(`tr[data-serial="${CSS.escape(String(item.serial))}"]`);
    if (tr) _loadBulkRowImages(tr, item);
  });
};

/**
 * Full render — toolbar + table body. Called on open and after bulk actions.
 */
const renderBulkTable = () => {
  renderBulkToolbar();
  renderBulkTableBody();
};

// =============================================================================
// SELECTION MANAGEMENT
// =============================================================================

const toggleItemSelection = (serial) => {
  serial = String(serial);
  if (bulkSelection.has(serial)) {
    bulkSelection.delete(serial);
  } else {
    bulkSelection.add(serial);
  }
  // When search is active, pinned rows appear/disappear — full re-render needed
  const term = (bulkSearchTerm || "").toLowerCase().trim();
  if (term) {
    renderBulkTableBody();
  } else {
    updateBulkSelectionUI();
  }
};

const selectAllItems = (select) => {
  const filtered = getFilteredItems(bulkSearchTerm);

  if (select) {
    // Select All: add only filtered (search-matched) items
    filtered.forEach((item) => bulkSelection.add(String(item.serial)));
  } else {
    // Deselect All: clear everything including pinned
    bulkSelection.clear();
  }
  renderBulkTableBody();
  renderBulkFooter();
};

const updateBulkSelectionUI = () => {
  // Update count badge
  const badge = safeGetElement("bulkEditCountBadge");
  if (badge) badge.textContent = bulkSelection.size + " selected";

  // Targeted row updates via data-serial attribute
  const wrap = safeGetElement("bulkEditTableWrap");
  if (wrap) {
    const rows = wrap.querySelectorAll("tbody tr[data-serial]");
    rows.forEach((tr) => {
      const serial = tr.getAttribute("data-serial");
      const isSelected = bulkSelection.has(serial);
      const cb = tr.querySelector('input[type="checkbox"]');

      if (isSelected) {
        tr.classList.add("bulk-edit-selected");
      } else {
        tr.classList.remove("bulk-edit-selected");
      }
      if (cb) cb.checked = isSelected;
    });

    // Update master checkbox — exclude pinned rows from the calculation
    const masterCb = wrap.querySelector('thead input[type="checkbox"]');
    if (masterCb) {
      const filteredRows = wrap.querySelectorAll("tbody tr[data-serial]:not(.bulk-edit-pinned)");
      const allSelected =
        filteredRows.length > 0 &&
        Array.from(filteredRows).every((tr) => bulkSelection.has(tr.getAttribute("data-serial")));
      const someSelected =
        !allSelected &&
        Array.from(filteredRows).some((tr) => bulkSelection.has(tr.getAttribute("data-serial")));
      masterCb.checked = allSelected;
      masterCb.indeterminate = someSelected;
    }
  }

  renderBulkFooter();
};

// =============================================================================
// FOOTER (action buttons)
// =============================================================================

const renderBulkFooter = () => {
  const footer = safeGetElement("bulkEditFooter");
  if (!footer) return;

  while (footer.firstChild) footer.removeChild(footer.firstChild);

  const count = bulkSelection.size;
  const enabledCount = bulkEnabledFields.size;

  // Apply Changes button
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.id = "bulkEditApplyBtn";
  applyBtn.className = "btn premium";
  applyBtn.textContent = "Apply Changes" + (count ? " (" + count + ")" : "");
  applyBtn.disabled = count === 0 || enabledCount === 0;
  applyBtn.title =
    count === 0 ? "Select items first" : enabledCount === 0 ? "Enable at least one field" : "";
  applyBtn.addEventListener("click", applyBulkEdit);
  footer.appendChild(applyBtn);

  // Copy Selected button
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn secondary";
  copyBtn.textContent = "Copy Selected" + (count ? " (" + count + ")" : "");
  copyBtn.disabled = count === 0;
  copyBtn.addEventListener("click", copySelectedItems);
  footer.appendChild(copyBtn);

  // Delete Selected button (danger, pushed right)
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger";
  deleteBtn.textContent = "Delete Selected" + (count ? " (" + count + ")" : "");
  deleteBtn.disabled = count === 0;
  deleteBtn.addEventListener("click", deleteSelectedItems);
  footer.appendChild(deleteBtn);
};

// =============================================================================
// CONFIRM HELPER (replaces window.confirm suppressed inside modal context)
// =============================================================================

/**
 * Show an inline confirmation modal and return a Promise<boolean>.
 * Resolves true on Confirm, false on Cancel or close.
 * @param {string} message
 * @returns {Promise<boolean>}
 */
const showBulkConfirm = (message) => {
  return new Promise(function (resolve) {
    var modal = document.getElementById("bulkConfirmModal");
    var msgEl = document.getElementById("bulkConfirmMessage");
    var okBtn = document.getElementById("bulkConfirmOkBtn");
    var canBtn = document.getElementById("bulkConfirmCancelBtn");
    if (!modal || !okBtn || !canBtn) {
      resolve(false);
      return;
    }

    if (msgEl) msgEl.textContent = message;
    modal.style.display = "flex";

    function cleanup(result) {
      modal.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      canBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onOk() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }

    okBtn.addEventListener("click", onOk);
    canBtn.addEventListener("click", onCancel);
  });
};

// =============================================================================
// BULK ACTIONS
// =============================================================================

/**
 * Reads the current value of each enabled bulk-edit field input into a plain
 * { fieldId: rawValue } map. Disabled/missing inputs are skipped.
 * @returns {Object<string, string>} Raw input values keyed by field id
 */
const collectBulkFieldValues = () => {
  const valuesToApply = {};
  bulkEnabledFields.forEach((fieldId) => {
    const input = safeGetElement("bulkFieldVal_" + fieldId);
    if (input) valuesToApply[fieldId] = input.value;
  });
  return valuesToApply;
};

/**
 * Validates and resolves the custom-purity input when the purity select is set
 * to "custom". On success the resolved raw purity string is written back into
 * valuesToApply; on failure a toast is shown.
 * @param {Object<string, string>} valuesToApply - Collected field values (mutated)
 * @returns {boolean} true if valid (or not applicable), false to abort the apply
 */
const resolveBulkCustomPurity = (valuesToApply) => {
  if (!(bulkEnabledFields.has("purity") && valuesToApply.purity === "custom")) return true;

  const purityCustomInput = safeGetElement("bulkFieldVal_purityCustom");
  const rawPurity = purityCustomInput ? purityCustomInput.value.trim() : "";
  const numericPurity = Number(rawPurity);

  if (!rawPurity || !Number.isFinite(numericPurity) || numericPurity < 0.001 || numericPurity > 1) {
    if (typeof showCloudToast === "function")
      showCloudToast(
        "Please enter a custom purity between 0.001 and 1 before applying bulk changes."
      );
    return false;
  }

  // Keep the original string; coercion logic will normalize as needed.
  valuesToApply.purity = rawPurity;
  return true;
};

/**
 * Converts a single weight value from its source unit to troy ounces for
 * storage (matches parseWeight in events.js). Non-numeric inputs are returned
 * unchanged.
 * @param {string} rawWeight - Raw weight string from the input
 * @param {string} effectiveUnit - The source unit (g/kg/lb/etc.)
 * @returns {string} The weight string, converted to ozt when applicable
 */
const convertBulkWeightToOzt = (rawWeight, effectiveUnit) => {
  const numeric = parseFloat(rawWeight);
  if (isNaN(numeric)) return rawWeight;
  if (effectiveUnit === "g") return String(gramsToOzt(numeric));
  if (effectiveUnit === "kg") return String(kgToOzt(numeric));
  if (effectiveUnit === "lb") return String(lbToOzt(numeric));
  return rawWeight;
};

/**
 * Normalizes the weight value in valuesToApply: applies unit→ozt conversion and
 * reads the denomination picker when goldback mode is active. Mutates the map
 * in place. No-op when the weight field is not enabled.
 * @param {Object<string, string>} valuesToApply - Collected field values (mutated)
 * @returns {void}
 */
const normalizeBulkWeightValue = (valuesToApply) => {
  if (!bulkEnabledFields.has("weight")) return;

  const unitSelect = safeGetElement("bulkFieldVal_weightUnit");
  const selectUnit = unitSelect ? unitSelect.value : null;

  // Convert gram/kg/lb weight to ozt for storage (matches parseWeight).
  if (valuesToApply.weight !== undefined) {
    const effectiveUnit = valuesToApply.weightUnit || selectUnit;
    valuesToApply.weight = convertBulkWeightToOzt(valuesToApply.weight, effectiveUnit);
  }

  // When gb denomination mode is active, read weight from the denomination
  // picker (the hidden number input has a stale/empty value). Check both an
  // explicit weightUnit in the apply set and a visibly-active picker.
  const denomSelect = safeGetElement("bulkFieldVal_weightDenom");
  const isSbMode = valuesToApply["weightUnit"] === "sb" || selectUnit === "sb";
  const isGbMode = !isSbMode && (valuesToApply["weightUnit"] === "gb" || selectUnit === "gb");
  if (isGbMode && denomSelect && denomSelect.style.display !== "none") {
    valuesToApply["weight"] = denomSelect.value;
  }
};

/**
 * Builds the human-readable comma-joined label list of all enabled fields,
 * used in the apply-confirmation prompt.
 * @returns {string} Comma-separated field labels
 */
const getBulkEnabledFieldNames = () =>
  [...bulkEnabledFields]
    .map((id) => {
      const def = BULK_EDITABLE_FIELDS.find((f) => f.id === id);
      return def ? def.label : id;
    })
    .join(", ");

/**
 * Snapshots an item for change logging, deep-copying nested objects we may
 * mutate (numistaData, fieldMeta) so the snapshot survives in-place edits — a
 * shallow Object.assign would share references and erase before/after diffs
 * (STRK-91).
 * @param {Object} item - The inventory item to snapshot
 * @returns {Object} A snapshot with deep-copied nested objects
 */
const snapshotBulkItem = (item) => {
  const oldItem = Object.assign({}, item);
  if (item.numistaData && typeof item.numistaData === "object") {
    oldItem.numistaData = structuredClone(item.numistaData);
  }
  if (item.fieldMeta && typeof item.fieldMeta === "object") {
    oldItem.fieldMeta = structuredClone(item.fieldMeta);
  }
  return oldItem;
};

/**
 * Clears incompatible numistaData dimension keys after a shape change, mirroring
 * the single-item modal's toggleDimensionFields behavior. Intentionally skips
 * the parseDimensions copy-then-clear step — bulk edit just clears stale keys
 * cleanly (STRK-91 explicit decision).
 * @param {Object} item - The inventory item with a freshly-applied shape
 * @returns {void}
 */
const clearIncompatibleShapeDimensions = (item) => {
  const shapeValue = item.numistaData.shape;
  const category =
    typeof window.classifyShape === "function" ? window.classifyShape(shapeValue) : "round";
  if (category === "rectangular" || category === "square") {
    delete item.numistaData.diameter;
  } else {
    delete item.numistaData.length;
    delete item.numistaData.width;
  }
};

/**
 * Applies the post-assignment cleanup/side-effects for a single bulk-edited
 * item: empty-key deletions (paymentMethod/capsule), shape dimension cleanup,
 * user-modified tracking, capsule autocomplete registration, and search-cache
 * invalidation.
 * @param {Object} item - The inventory item after field values were applied
 * @returns {void}
 */
const applyBulkItemSideEffects = (item) => {
  if (bulkEnabledFields.has("paymentMethod") && !item.paymentMethod) {
    delete item.paymentMethod;
  }

  // Empty capsule / capsuleNotes → delete key (parity with paymentMethod).
  if (bulkEnabledFields.has("capsule") && !item.capsule) {
    delete item.capsule;
  }
  if (bulkEnabledFields.has("capsuleNotes") && !item.capsuleNotes) {
    delete item.capsuleNotes;
  }

  if (bulkEnabledFields.has("shape") && item.numistaData) {
    clearIncompatibleShapeDimensions(item);
  }

  // Track user-overridden shape for parity with single-item modal
  // (events.js:1830-1869).
  if (bulkEnabledFields.has("shape") && typeof window.markUserModified === "function") {
    window.markUserModified(item, "shape");
  }

  // Register non-empty capsule for autocomplete (capsuleNotes is NOT registered).
  if (
    bulkEnabledFields.has("capsule") &&
    item.capsule &&
    typeof window.registerCapsule === "function"
  ) {
    window.registerCapsule(item.capsule);
  }

  // STACK-62: Invalidate search cache for modified item
  if (typeof window.invalidateSearchCache === "function") {
    window.invalidateSearchCache(item);
  }
};

/**
 * Applies the collected field values (plus cleanup side-effects and change
 * logging) to every selected inventory item.
 * @param {Object<string, string>} valuesToApply - Resolved field values
 * @returns {number} The count of items updated
 */
const applyBulkValuesToSelection = (valuesToApply) => {
  let updated = 0;
  inventory.forEach((item) => {
    if (!bulkSelection.has(String(item.serial))) return;

    const oldItem = snapshotBulkItem(item);

    // Apply each enabled field — honor BULK_FIELD_STORAGE_MAP for nested paths.
    Object.keys(valuesToApply).forEach((fieldId) => {
      const coerced = coerceFieldValue(fieldId, valuesToApply[fieldId]);
      applyBulkFieldToItem(item, fieldId, coerced);
    });

    applyBulkItemSideEffects(item);

    // Log changes for undo support
    if (typeof logItemChanges === "function") {
      logItemChanges(oldItem, item);
    }

    updated++;
  });
  return updated;
};

/**
 * Records price data points for selected items when any price-relevant field
 * was edited (STACK-43), then persists price history.
 * @returns {void}
 */
const recordBulkPriceHistory = () => {
  if (typeof recordItemPrice !== "function") return;
  const priceFields = ["price", "marketValue", "weight", "weightUnit", "qty", "metal", "purity"];
  if (![...bulkEnabledFields].some((id) => priceFields.includes(id))) return;
  inventory.forEach((item) => {
    if (bulkSelection.has(String(item.serial))) recordItemPrice(item, "bulk");
  });
  saveItemPriceHistory();
};

const applyBulkEdit = async () => {
  const count = bulkSelection.size;
  const enabledCount = bulkEnabledFields.size;
  if (count === 0 || enabledCount === 0) return;

  const valuesToApply = collectBulkFieldValues();

  if (!resolveBulkCustomPurity(valuesToApply)) return;

  if (bulkEnabledFields.has("type") && valuesToApply.type === "Silverback") {
    valuesToApply.weightUnit = "sb";
  }

  normalizeBulkWeightValue(valuesToApply);

  const fieldNames = getBulkEnabledFieldNames();
  if (
    !(await showBulkConfirm(
      "Apply " + enabledCount + " field(s) (" + fieldNames + ") to " + count + " item(s)?"
    ))
  ) {
    return;
  }

  const updated = applyBulkValuesToSelection(valuesToApply);

  recordBulkPriceHistory();

  // Persist and re-render
  if (typeof saveInventory === "function") saveInventory();
  if (typeof renderTable === "function") renderTable();
  if (typeof renderActiveFilters === "function") renderActiveFilters();

  if (typeof showCloudToast === "function") showCloudToast("Updated " + updated + " item(s).");

  // Refresh bulk table to reflect changes
  renderBulkTable();
  renderBulkFooter();
};

const copySelectedItems = async () => {
  const count = bulkSelection.size;
  if (count === 0) return;

  if (
    !(await showBulkConfirm(
      "Copy " + count + " item(s)? New copies will be added to your inventory."
    ))
  ) {
    return;
  }

  let copied = 0;
  const serialsToProcess = [...bulkSelection];

  serialsToProcess.forEach((serial) => {
    const item = inventory.find((i) => String(i.serial) === serial);
    if (!item) return;

    // Deep clone
    const clone = JSON.parse(JSON.stringify(item));
    clone.serial = getNextSerial();
    clone.uuid = generateUUID();

    inventory.push(clone);

    // Record initial price data point for the copy (STACK-43)
    if (typeof recordSingleItemPrice === "function") {
      recordSingleItemPrice(clone, "add");
    }

    // Log the copy
    if (typeof logChange === "function") {
      logChange(
        clone.name,
        "Copied",
        "from serial " + serial,
        "new serial " + clone.serial,
        inventory.length - 1
      );
    }

    copied++;
  });

  if (typeof saveInventory === "function") saveInventory();
  if (typeof renderTable === "function") renderTable();

  if (typeof showCloudToast === "function") showCloudToast("Copied " + copied + " item(s).");

  renderBulkTable();
  renderBulkFooter();
};

const deleteSelectedItems = async () => {
  const count = bulkSelection.size;
  if (count === 0) return;

  if (
    !(await showBulkConfirm(
      "Delete " + count + " item(s)? You can undo deletions from the Change Log."
    ))
  ) {
    return;
  }

  // Collect indices to delete (sorted descending to avoid splice shift issues)
  const indicesToDelete = [];
  inventory.forEach((item, idx) => {
    if (bulkSelection.has(String(item.serial))) {
      indicesToDelete.push(idx);
    }
  });
  indicesToDelete.sort((a, b) => b - a);

  indicesToDelete.forEach((idx) => {
    const item = inventory[idx];
    if (typeof logChange === "function") {
      logChange(item.name, "Deleted", JSON.stringify(item), "", idx);
    }
    inventory.splice(idx, 1);
  });

  // Clear deleted serials from selection
  indicesToDelete.forEach(() => {
    // Already spliced — remove from selection by checking what's left
  });
  const remaining = new Set(inventory.map((i) => String(i.serial)));
  bulkSelection.forEach((s) => {
    if (!remaining.has(s)) bulkSelection.delete(s);
  });

  if (typeof saveInventory === "function") saveInventory();
  if (typeof renderTable === "function") renderTable();
  if (typeof renderActiveFilters === "function") renderActiveFilters();

  if (typeof showCloudToast === "function")
    showCloudToast("Deleted " + indicesToDelete.length + " item(s).");

  renderBulkTable();
  renderBulkFooter();
};

// =============================================================================
// NUMISTA INTEGRATION
// =============================================================================

const triggerBulkNumistaLookup = async () => {
  if (!catalogAPI || !catalogAPI.activeProvider) {
    if (typeof showCloudToast === "function")
      showCloudToast("Configure Numista API key in Settings first.");
    return;
  }

  // Set our callback — fillFormFromNumistaResult checks this before normal form fill
  window._bulkEditNumistaCallback = receiveBulkNumistaResult;

  // Prompt user for search query
  const query =
    typeof showAppPrompt === "function"
      ? await showAppPrompt("Enter a coin name or Numista N# to search:", "", "Numista Lookup")
      : null;
  if (!query || !query.trim()) {
    window._bulkEditNumistaCallback = null;
    return;
  }

  // Perform search
  const trimmed = query.trim();
  const isDirectLookup = /^N?\d+$/i.test(trimmed);

  (async () => {
    try {
      let results;
      if (isDirectLookup) {
        const result = await catalogAPI.lookupItem(trimmed);
        results = result ? [result] : [];
        if (typeof showNumistaResults === "function") {
          showNumistaResults(results, true, trimmed);
        }
      } else {
        results = await catalogAPI.searchItems(trimmed, { limit: 20 });
        if (typeof showNumistaResults === "function") {
          showNumistaResults(results, false, trimmed);
        }
      }
    } catch (error) {
      console.error("Bulk Numista search error:", error);
      if (typeof showCloudToast === "function")
        showCloudToast("Numista search failed: " + error.message);
      window._bulkEditNumistaCallback = null;
    }
  })();
};

const receiveBulkNumistaResult = (fieldMap) => {
  if (!fieldMap || typeof fieldMap !== "object") return;

  // Populate bulk edit field inputs and enable them
  Object.keys(fieldMap).forEach((fieldId) => {
    const fieldDef = BULK_EDITABLE_FIELDS.find((f) => f.id === fieldId);
    if (!fieldDef) return;

    const input = safeGetElement("bulkFieldVal_" + fieldId);
    const cb = safeGetElement("bulkField_" + fieldId);
    if (!input) return;

    if (fieldId === "purity" && input.tagName === "SELECT") {
      const optionExists = Array.from(input.options).some(
        (option) => option.value === String(fieldMap[fieldId])
      );
      input.value = optionExists ? String(fieldMap[fieldId]) : "custom";
      const purityCustomInput = safeGetElement("bulkFieldVal_purityCustom");
      if (purityCustomInput && !optionExists) {
        purityCustomInput.value = String(fieldMap[fieldId]);
      }
      // Enable field and check checkbox before dispatching change event
      // so syncPurityState() sees the correct disabled state
      input.disabled = false;
      bulkFieldValues[fieldId] = fieldMap[fieldId];
      bulkEnabledFields.add(fieldId);
      if (cb) cb.checked = true;
      input.dispatchEvent(new Event("change"));
    } else {
      input.value = fieldMap[fieldId];
      input.disabled = false;
      bulkFieldValues[fieldId] = fieldMap[fieldId];
      bulkEnabledFields.add(fieldId);
      if (cb) cb.checked = true;
    }
  });

  // Update footer to reflect newly enabled fields
  renderBulkFooter();

  // STRK-91 C.4: refresh the collapsible panel's enabled-field count without
  // re-rendering the panel (preserves user collapse state on mobile).
  const summaryCount = safeGetElement("bulkEditFieldPanelCount");
  if (summaryCount instanceof HTMLElement) {
    summaryCount.textContent = `${bulkEnabledFields.size} enabled`;
  }

  // Clear the callback
  window._bulkEditNumistaCallback = null;
};

// =============================================================================
// WINDOW EXPORTS
// =============================================================================

window.openBulkEdit = openBulkEdit;
window.closeBulkEdit = closeBulkEdit;

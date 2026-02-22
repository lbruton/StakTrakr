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

let bulkSelection = new Set();     // Set of item serial strings
let bulkFieldValues = {};           // { fieldId: value } for enabled fields
let bulkEnabledFields = new Set();  // Which field checkboxes are checked
let bulkSearchTerm = '';            // Current search/filter text
let bulkSearchTimer = null;         // Debounce timer for search input
let bulkSortCol = null;             // Column key to sort by, or null
let bulkSortDir = 'asc';            // 'asc' | 'desc'

// Tracks blob URLs created for bulk image thumbnails so we can revoke them
// when the modal closes, preventing memory leaks.
const _bulkBlobUrls = new Set();

const BULK_COLUMN_PRIORITY = [
  'name',
  'metal',
  'composition',
  'type',
  'qty',
  'weight',
  'weightUnit',
  'purity',
  'price',
  'marketValue',
  'spotPriceAtPurchase',
  'premiumPerOz',
  'totalPremium',
  'year',
  'grade',
  'gradingAuthority',
  'certNumber',
  'pcgsNumber',
  'serialNumber',
  'numistaId',
  'purchaseLocation',
  'storageLocation',
  'date',
  'notes',
  'collectable',
  'pcgsVerified',
  'obverseImageUrl',
  'reverseImageUrl',
  'serial',
  'uuid'
];

const BULK_COLUMN_LABEL_OVERRIDES = {
  qty: 'Qty',
  marketValue: 'Retail Price',
  spotPriceAtPurchase: 'Spot At Purchase',
  premiumPerOz: 'Premium / Oz',
  totalPremium: 'Total Premium',
  gradingAuthority: 'Grading Authority',
  certNumber: 'Cert #',
  pcgsNumber: 'PCGS #',
  numistaId: 'Numista #',
  purchaseLocation: 'Purchased At',
  storageLocation: 'Storage Location',
  obverseImageUrl: 'Obverse URL',
  reverseImageUrl: 'Reverse URL',
  uuid: 'UUID'
};

const normalizeBulkValue = (value) => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeBulkValue(entry)).join(' ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }
  return String(value);
};

const getBulkTableDataKeys = () => {
  if (typeof inventory === 'undefined' || !Array.isArray(inventory)) return [];
  const keySet = new Set();
  inventory.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    Object.keys(item).forEach((key) => keySet.add(key));
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
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getBulkSortableValue = (item, key) => {
  if (!item || !key) return '';
  return normalizeBulkValue(item[key]);
};

const formatBulkCellValue = (item, key) => {
  if (!item || !key) return '';
  const value = item[key];
  if (value === null || value === undefined) return '';

  switch (key) {
    case 'weight':
      return typeof formatWeight === 'function'
        ? formatWeight(item.weight, item.weightUnit)
        : String(value);
    case 'price':
    case 'marketValue':
    case 'spotPriceAtPurchase':
    case 'premiumPerOz':
    case 'totalPremium': {
      const numeric = Number(value);
      if (typeof formatCurrency === 'function' && !Number.isNaN(numeric)) {
        return formatCurrency(numeric);
      }
      return String(value);
    }
    default:
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      if (Array.isArray(value)) return value.map((entry) => normalizeBulkValue(entry)).join(', ');
      if (typeof value === 'object') return normalizeBulkValue(value);
      return String(value);
  }
};

// =============================================================================
// SEARCH FILTER HELPER
// =============================================================================

const getFilteredItems = (term) => {
  if (typeof inventory === 'undefined' || !Array.isArray(inventory)) return [];
  const t = (term || '').toLowerCase().trim();
  if (!t) return inventory.slice();
  return inventory.filter((item) => {
    const tagText = typeof getItemTags === 'function' ? getItemTags(item.uuid).join(' ') : '';
    const itemValues = Object.keys(item || {}).map((key) => normalizeBulkValue(item[key]));
    const searchText = [...itemValues, tagText]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');
    return searchText.includes(t);
  });
};

// =============================================================================
// EDITABLE FIELDS DEFINITION
// =============================================================================

const BULK_EDITABLE_FIELDS = [
  { id: 'name',             label: 'Name',              inputType: 'text' },
  { id: 'metal',            label: 'Metal',             inputType: 'select',
    options: ['Silver', 'Gold', 'Platinum', 'Palladium'] },
  { id: 'type',             label: 'Type',              inputType: 'select',
    options: ['Coin', 'Bar', 'Round', 'Note', 'Aurum', 'Set', 'Other'] },
  { id: 'qty',              label: 'Quantity',           inputType: 'number',
    attrs: { min: '1', step: '1' } },
  { id: 'weight',           label: 'Weight',             inputType: 'number',
    attrs: { min: '0', step: '0.001' } },
  { id: 'weightUnit',       label: 'Weight Unit',        inputType: 'select',
    options: [
      { value: 'oz', label: 'ounce' },
      { value: 'g',  label: 'gram' },
      { value: 'gb', label: 'goldback' }
    ] },
  { id: 'purity',           label: 'Purity',             inputType: 'select',
    options: [
      { value: '1.0',    label: '100% — Pure' },
      { value: '0.9999', label: '.9999 — Four Nines' },
      { value: '0.9995', label: '.9995 — Pure Platinum' },
      { value: '0.999',  label: '.999 — Fine' },
      { value: '0.925',  label: '.925 — Sterling' },
      { value: '0.9167', label: '.9167 — 22K (Krugerrand)' },
      { value: '0.900',  label: '.900 — 90% Silver' },
      { value: '0.800',  label: '.800 — 80% (European)' },
      { value: '0.600',  label: '.600 — 60%' },
      { value: '0.400',  label: '.400 — 40% Silver' },
      { value: '0.350',  label: '.350 — War Nickels' },
      { value: 'custom', label: 'Custom…' }
    ] },
  { id: 'price',            label: 'Purchase Price',     inputType: 'number',
    attrs: { min: '0', step: '0.01' } },
  { id: 'marketValue',      label: 'Retail Price',       inputType: 'number',
    attrs: { min: '0', step: '0.01' } },
  { id: 'year',             label: 'Year',              inputType: 'text' },
  { id: 'grade',            label: 'Grade',             inputType: 'select',
    options: [
      { value: '', label: '-- None --' },
      { value: 'AG', label: 'AG - About Good' },
      { value: 'G', label: 'G - Good' },
      { value: 'VG', label: 'VG - Very Good' },
      { value: 'F', label: 'F - Fine' },
      { value: 'VF', label: 'VF - Very Fine' },
      { value: 'XF', label: 'XF - Extremely Fine' },
      { value: 'AU', label: 'AU - About Uncirculated' },
      { value: 'UNC', label: 'UNC - Uncirculated' },
      { value: 'BU', label: 'BU - Brilliant Uncirculated' },
      { value: 'MS-60', label: 'MS-60' },
      { value: 'MS-61', label: 'MS-61' },
      { value: 'MS-62', label: 'MS-62' },
      { value: 'MS-63', label: 'MS-63' },
      { value: 'MS-64', label: 'MS-64' },
      { value: 'MS-65', label: 'MS-65' },
      { value: 'MS-66', label: 'MS-66' },
      { value: 'MS-67', label: 'MS-67' },
      { value: 'MS-68', label: 'MS-68' },
      { value: 'MS-69', label: 'MS-69' },
      { value: 'MS-70', label: 'MS-70' },
      { value: 'PF-60', label: 'PF-60' },
      { value: 'PF-61', label: 'PF-61' },
      { value: 'PF-62', label: 'PF-62' },
      { value: 'PF-63', label: 'PF-63' },
      { value: 'PF-64', label: 'PF-64' },
      { value: 'PF-65', label: 'PF-65' },
      { value: 'PF-66', label: 'PF-66' },
      { value: 'PF-67', label: 'PF-67' },
      { value: 'PF-68', label: 'PF-68' },
      { value: 'PF-69', label: 'PF-69' },
      { value: 'PF-70', label: 'PF-70' }
    ] },
  { id: 'gradingAuthority', label: 'Grading Auth',      inputType: 'select',
    options: [
      { value: '', label: '-- None --' },
      { value: 'PCGS', label: 'PCGS' },
      { value: 'NGC', label: 'NGC' },
      { value: 'ANACS', label: 'ANACS' },
      { value: 'ICG', label: 'ICG' }
    ] },
  { id: 'certNumber',       label: 'Cert #',             inputType: 'text' },
  { id: 'pcgsNumber',       label: 'PCGS Number',       inputType: 'text' },
  { id: 'purchaseLocation', label: 'Purchase Loc',      inputType: 'text' },
  { id: 'storageLocation',  label: 'Storage Loc',       inputType: 'text' },
  { id: 'date',             label: 'Purchase Date',     inputType: 'date' },
  { id: 'serialNumber',     label: 'Serial Number',     inputType: 'text' },
  { id: 'notes',            label: 'Notes',             inputType: 'textarea' },
  { id: 'numistaId',        label: 'Numista #',         inputType: 'text' },
  { id: 'obverseImageUrl',  label: 'Obverse URL',       inputType: 'text',
    attrs: { placeholder: 'https://example.com/obverse.jpg' } },
  { id: 'reverseImageUrl',  label: 'Reverse URL',       inputType: 'text',
    attrs: { placeholder: 'https://example.com/reverse.jpg' } },
];

// =============================================================================
// OPEN / CLOSE
// =============================================================================

const openBulkEdit = () => {
  const modal = safeGetElement('bulkEditModal');
  if (!modal) return;

  // Always start with a clean selection (STACK-55)
  bulkSelection = new Set();

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  renderBulkFieldPanel();
  renderBulkTable();
  renderBulkFooter();

  // Focus search input after render
  const searchInput = safeGetElement('bulkEditSearch');
  if (searchInput) searchInput.focus();
};

const closeBulkEdit = () => {
  const modal = safeGetElement('bulkEditModal');
  if (!modal) return;

  // Clear Numista callback
  window._bulkEditNumistaCallback = null;

  // Revoke all blob URLs created for thumbnails to free memory
  _bulkBlobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
  _bulkBlobUrls.clear();

  modal.style.display = 'none';
  document.body.style.overflow = '';
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
  if (field.inputType === 'select') {
    input = document.createElement('select');
    field.options.forEach(opt => {
      const option = document.createElement('option');
      if (typeof opt === 'object' && opt !== null) {
        option.value = opt.value;
        option.textContent = opt.label;
      } else {
        option.value = opt;
        option.textContent = opt;
      }
      input.appendChild(option);
    });
  } else if (field.inputType === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 2;
  } else {
    input = document.createElement('input');
    input.type = field.inputType;
    if (field.attrs) {
      Object.keys(field.attrs).forEach(k => input.setAttribute(k, field.attrs[k]));
    }
  }
  input.className = 'field-input';
  input.id = 'bulkFieldVal_' + field.id;
  return input;
};

/** Coercion rules: fieldId → (rawValue) => coerced value */
const FIELD_COERCIONS = {
  qty:         (v) => { const n = parseInt(v, 10);  return (isNaN(n) || n < 1)            ? 1   : n; },
  weight:      (v) => { const n = parseFloat(v);    return (isNaN(n) || n < 0)            ? 0   : n; },
  price:       (v) => { const n = parseFloat(v);    return (isNaN(n) || n < 0)            ? 0   : n; },
  marketValue: (v) => { const n = parseFloat(v);    return (isNaN(n) || n < 0)            ? 0   : n; },
  purity:      (v) => { const n = parseFloat(v);    return (isNaN(n) || n <= 0 || n > 1)  ? 1.0 : n; },
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
  return (typeof value === 'string') ? sanitizeHtml(value) : value;
};

/**
 * Builds a table row element for a single inventory item in the bulk edit table.
 * @param {Object} item - The inventory item
 * @param {boolean} isPinned - Whether the row is in the pinned section
 * @returns {HTMLTableRowElement} The constructed row
 */
const buildBulkItemRow = (item, isPinned, dataColumns) => {
  const serial = String(item.serial);
  const tr = document.createElement('tr');
  tr.setAttribute('data-serial', serial);
  const isSelected = bulkSelection.has(serial);
  if (isSelected) tr.classList.add('bulk-edit-selected');
  if (isPinned) tr.classList.add('bulk-edit-pinned');

  // Row click toggles selection
  tr.addEventListener('click', (e) => {
    if (e.target.type === 'checkbox') return;
    toggleItemSelection(serial);
  });

  // Checkbox cell
  const cbTd = document.createElement('td');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = isSelected;
  cb.addEventListener('change', () => toggleItemSelection(serial));
  cbTd.appendChild(cb);
  tr.appendChild(cbTd);

  // Image thumbnail cell — resolved async from IDB after row is appended
  const imgTd = document.createElement('td');
  imgTd.className = 'bulk-img-cell';
  // Placeholder pair shown until IDB resolves
  imgTd.innerHTML = '<span class="bulk-img-placeholder" data-side="obverse"></span>';
  // Store item identity for the async loader and upload popover
  imgTd.dataset.uuid       = item.uuid || '';
  imgTd.dataset.numistaId  = item.numistaId || '';
  imgTd.dataset.itemName   = item.name || '';
  imgTd.dataset.serial     = serial;
  imgTd.title = 'Click to manage photos';
  imgTd.style.cursor = 'pointer';
  imgTd.addEventListener('click', (e) => {
    e.stopPropagation();
    _openBulkImagePopover(imgTd, item);
  });
  tr.appendChild(imgTd);

  // Data cells
  const addCell = (text) => {
    const td = document.createElement('td');
    td.textContent = text || '';
    td.title = text || '';
    tr.appendChild(td);
  };

  dataColumns.forEach((column) => {
    addCell(formatBulkCellValue(item, column.key));
  });

  return tr;
};

// =============================================================================
// FIELD PANEL (left side)
// =============================================================================

const renderBulkFieldPanel = () => {
  const panel = safeGetElement('bulkEditFieldPanel');
  if (!panel) return;

  // Clear existing content
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  // Header
  const heading = document.createElement('h3');
  heading.textContent = 'Fields to Update';
  panel.appendChild(heading);

  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:0.75rem;color:var(--text-secondary);margin:0 0 0.75rem 0;';
  hint.textContent = 'Check a field to enable it, then set the value to apply.';
  panel.appendChild(hint);

  // Build field rows
  BULK_EDITABLE_FIELDS.forEach(field => {
    const row = document.createElement('div');
    row.className = 'bulk-edit-field-row';

    // Checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'bulkField_' + field.id;
    cb.checked = bulkEnabledFields.has(field.id);

    // Label
    const lbl = document.createElement('label');
    lbl.setAttribute('for', 'bulkField_' + field.id);
    lbl.textContent = field.label;

    // Input
    const input = createFieldInput(field);
    input.disabled = !bulkEnabledFields.has(field.id);

    // Restore persisted value
    if (bulkFieldValues[field.id] !== undefined) {
      input.value = bulkFieldValues[field.id];
    }

    // Checkbox toggle — also re-renders footer to update Apply button disabled state
    cb.addEventListener('change', () => {
      if (cb.checked) {
        bulkEnabledFields.add(field.id);
        input.disabled = false;
        input.focus();
      } else {
        bulkEnabledFields.delete(field.id);
        input.disabled = true;
      }
      renderBulkFooter();
    });

    // Track value changes
    input.addEventListener('input', () => {
      bulkFieldValues[field.id] = input.value;
    });
    input.addEventListener('change', () => {
      bulkFieldValues[field.id] = input.value;
    });

    row.appendChild(cb);
    row.appendChild(lbl);
    row.appendChild(input);
    panel.appendChild(row);
  });

  // Wire up denomination picker swap for weight field (mirrors main modal)
  const bwInput = safeGetElement('bulkFieldVal_weight');
  const bwUnitSelect = safeGetElement('bulkFieldVal_weightUnit');
  const bwLabel = panel.querySelector('label[for="bulkField_weight"]');
  const bwCheckbox = safeGetElement('bulkField_weight');

  if (bwInput && bwUnitSelect && typeof GOLDBACK_DENOMINATIONS !== 'undefined') {
    // Build hidden denomination select
    const denomSelect = document.createElement('select');
    denomSelect.className = 'field-input';
    denomSelect.id = 'bulkFieldVal_weightDenom';
    denomSelect.style.display = 'none';
    denomSelect.disabled = bwInput.disabled;

    GOLDBACK_DENOMINATIONS.forEach(d => {
      const opt = document.createElement('option');
      opt.value = String(d.weight);
      opt.textContent = d.label;
      denomSelect.appendChild(opt);
    });

    // Insert right after weight input in the same row
    bwInput.parentNode.insertBefore(denomSelect, bwInput.nextSibling);

    // Restore persisted value
    if (bulkFieldValues['weight'] !== undefined) {
      denomSelect.value = String(bulkFieldValues['weight']);
    }

    // Track denomination changes → update weight field value
    denomSelect.addEventListener('change', () => {
      bulkFieldValues['weight'] = denomSelect.value;
    });

    // Swap function
    const toggleBulkGbPicker = () => {
      const isGb = bwUnitSelect.value === 'gb';
      bwInput.style.display = isGb ? 'none' : '';
      denomSelect.style.display = isGb ? '' : 'none';
      if (bwLabel) bwLabel.textContent = isGb ? 'Denomination' : 'Weight';
      if (isGb) {
        denomSelect.disabled = bwInput.disabled;
        bulkFieldValues['weight'] = denomSelect.value;
      }
    };

    // Listen for unit changes
    bwUnitSelect.addEventListener('change', toggleBulkGbPicker);

    // Sync disabled state when weight checkbox toggles
    if (bwCheckbox) {
      bwCheckbox.addEventListener('change', () => {
        denomSelect.disabled = !bwCheckbox.checked;
      });
    }

    // Initialize state (e.g. if weightUnit was persisted as 'gb')
    if (bulkFieldValues['weightUnit'] === 'gb') {
      bwUnitSelect.value = 'gb';
      toggleBulkGbPicker();
    }
  }

  // Wire up custom purity input behavior (matches inventory modal pattern)
  const puritySelect = safeGetElement('bulkFieldVal_purity');
  const purityCheckbox = safeGetElement('bulkField_purity');
  if (puritySelect) {
    const purityCustomInput = document.createElement('input');
    purityCustomInput.type = 'number';
    purityCustomInput.id = 'bulkFieldVal_purityCustom';
    purityCustomInput.className = 'field-input';
    purityCustomInput.min = '0.001';
    purityCustomInput.max = '1';
    purityCustomInput.step = '0.0001';
    purityCustomInput.placeholder = 'e.g. 0.9995';
    purityCustomInput.setAttribute('aria-label', 'Custom purity');
    purityCustomInput.style.display = 'none';
    purityCustomInput.disabled = puritySelect.disabled;
    puritySelect.parentNode.insertBefore(purityCustomInput, puritySelect.nextSibling);

    const optionValues = new Set(Array.from(puritySelect.options).map(option => option.value));
    const savedPurity = bulkFieldValues.purity;
    if (savedPurity !== undefined) {
      const savedPurityStr = String(savedPurity);
      if (optionValues.has(savedPurityStr) && savedPurityStr !== 'custom') {
        puritySelect.value = savedPurityStr;
      } else {
        puritySelect.value = 'custom';
        purityCustomInput.value = savedPurityStr;
      }
    }

    const syncPurityState = () => {
      const isCustom = puritySelect.value === 'custom';
      purityCustomInput.style.display = isCustom ? '' : 'none';
      purityCustomInput.disabled = puritySelect.disabled || !isCustom;
      if (isCustom) {
        bulkFieldValues.purity = purityCustomInput.value;
      } else {
        bulkFieldValues.purity = puritySelect.value;
      }
    };

    puritySelect.addEventListener('change', syncPurityState);
    purityCustomInput.addEventListener('input', () => {
      bulkFieldValues.purity = purityCustomInput.value;
    });
    purityCustomInput.addEventListener('change', () => {
      bulkFieldValues.purity = purityCustomInput.value;
    });

    if (purityCheckbox) {
      purityCheckbox.addEventListener('change', () => {
        syncPurityState();
      });
    }

    syncPurityState();
  }

};

// =============================================================================
// ITEM TABLE (right side)
// =============================================================================

/**
 * Renders the toolbar (search, buttons, badge) — called once on open.
 * The toolbar persists across search/selection updates.
 */
const renderBulkToolbar = () => {
  const toolbar = safeGetElement('bulkEditToolbar');
  if (!toolbar) return;

  while (toolbar.firstChild) toolbar.removeChild(toolbar.firstChild);

  // Numista Lookup button (left of search)
  if (typeof catalogAPI !== 'undefined') {
    const numistaBtn = document.createElement('button');
    numistaBtn.type = 'button';
    numistaBtn.className = 'bulk-edit-numista-btn';
    numistaBtn.textContent = 'Numista Lookup';
    numistaBtn.title = 'Search Numista catalog and fill field values';
    numistaBtn.addEventListener('click', triggerBulkNumistaLookup);
    toolbar.appendChild(numistaBtn);
  }

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.id = 'bulkEditSearch';
  searchInput.placeholder = 'Search items...';
  searchInput.value = bulkSearchTerm || '';
  searchInput.addEventListener('input', () => {
    // Debounce: wait 250ms after last keystroke before filtering
    if (bulkSearchTimer) clearTimeout(bulkSearchTimer);
    bulkSearchTimer = setTimeout(() => {
      bulkSearchTerm = searchInput.value;
      renderBulkTableBody();
    }, 250);
  });
  toolbar.appendChild(searchInput);

  const selectAllBtn = document.createElement('button');
  selectAllBtn.type = 'button';
  selectAllBtn.className = 'btn btn-secondary';
  selectAllBtn.textContent = 'Select All';
  selectAllBtn.addEventListener('click', () => selectAllItems(true));
  toolbar.appendChild(selectAllBtn);

  const selectNoneBtn = document.createElement('button');
  selectNoneBtn.type = 'button';
  selectNoneBtn.className = 'btn btn-secondary';
  selectNoneBtn.textContent = 'Select None';
  selectNoneBtn.addEventListener('click', () => selectAllItems(false));
  toolbar.appendChild(selectNoneBtn);

  const badge = document.createElement('span');
  badge.className = 'bulk-edit-count-badge';
  badge.id = 'bulkEditCountBadge';
  badge.textContent = bulkSelection.size + ' selected';
  toolbar.appendChild(badge);
};

/**
 * Renders the table body (rows) — called on search, selection, and data changes.
 * Does NOT touch the toolbar, preserving search input focus.
 */
const renderBulkTableBody = () => {
  const wrap = safeGetElement('bulkEditTableWrap');
  if (!wrap) return;

  while (wrap.firstChild) wrap.removeChild(wrap.firstChild);

  if (typeof inventory === 'undefined' || !Array.isArray(inventory) || inventory.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'padding:2rem;text-align:center;color:var(--text-secondary);';
    empty.textContent = 'No inventory items found.';
    wrap.appendChild(empty);
    return;
  }

  // Filter by search term
  const filtered = getFilteredItems(bulkSearchTerm);
  const term = (bulkSearchTerm || '').toLowerCase().trim();

  // Compute pinned items — selected items NOT in search results (only when search active)
  let pinnedItems = [];
  if (term) {
    const filteredSerials = new Set(filtered.map(i => String(i.serial)));
    pinnedItems = inventory.filter(item =>
      bulkSelection.has(String(item.serial)) && !filteredSerials.has(String(item.serial))
    );
  }

  const table = document.createElement('table');
  table.className = 'bulk-edit-table';

  const dataColumns = getBulkTableDataKeys().map((key) => ({
    key,
    label: getBulkColumnLabel(key)
  }));

  if (bulkSortCol && !dataColumns.some((column) => column.key === bulkSortCol)) {
    bulkSortCol = null;
  }

  // Column definitions
  const columns = [
    { key: 'cb',              label: '',              nosort: true },
    { key: 'img',             label: 'Img',           nosort: true },
    ...dataColumns
  ];
  const colCount = columns.length;

  // Sort filtered items (preserves original array for selection state checks)
  const sortedFiltered = bulkSortCol
    ? [...filtered].sort((a, b) => {
        const av = getBulkSortableValue(a, bulkSortCol);
        const bv = getBulkSortableValue(b, bulkSortCol);
        const numA = Number(av);
        const numB = Number(bv);
        const bothNumeric = av !== '' && bv !== '' && !Number.isNaN(numA) && !Number.isNaN(numB);
        const cmp = bothNumeric
          ? numA - numB
          : String(av).localeCompare(String(bv), undefined, {
            numeric: true,
            sensitivity: 'base'
          });
        return bulkSortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  // Master checkbox state (based on filtered items only, excludes pinned)
  const allFilteredSelected = filtered.length > 0 &&
    filtered.every(item => bulkSelection.has(String(item.serial)));
  const someFilteredSelected = !allFilteredSelected &&
    filtered.some(item => bulkSelection.has(String(item.serial)));

  // Thead
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  columns.forEach(col => {
    const th = document.createElement('th');
    if (col.key === 'cb') {
      const masterCb = document.createElement('input');
      masterCb.type = 'checkbox';
      masterCb.title = 'Toggle all visible';
      masterCb.checked = allFilteredSelected;
      masterCb.indeterminate = someFilteredSelected;
      masterCb.addEventListener('change', () => selectAllItems(masterCb.checked));
      th.appendChild(masterCb);
    } else if (col.nosort) {
      th.textContent = col.label;
    } else {
      th.textContent = col.label;
      th.classList.add('bulk-sortable');
      if (bulkSortCol === col.key) {
        th.classList.add(bulkSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
      th.addEventListener('click', () => {
        if (bulkSortCol === col.key) {
          bulkSortDir = bulkSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          bulkSortCol = col.key;
          bulkSortDir = 'asc';
        }
        renderBulkTableBody();
      });
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Tbody
  const tbody = document.createElement('tbody');

  // Pinned section (selected items not matching current search)
  if (pinnedItems.length > 0) {
    // Section header
    const headerTr = document.createElement('tr');
    headerTr.className = 'bulk-edit-pinned-header';
    const headerTd = document.createElement('td');
    headerTd.colSpan = colCount;
    headerTd.textContent = 'Pinned selections (' + pinnedItems.length + ')';
    headerTr.appendChild(headerTd);
    tbody.appendChild(headerTr);

    // Pinned rows
    pinnedItems.forEach(item => {
      tbody.appendChild(buildBulkItemRow(item, true, dataColumns));
    });

    // Divider
    const divTr = document.createElement('tr');
    divTr.className = 'bulk-edit-pinned-divider';
    const divTd = document.createElement('td');
    divTd.colSpan = colCount;
    divTr.appendChild(divTd);
    tbody.appendChild(divTr);
  }

  // Filtered rows (sorted)
  sortedFiltered.forEach(item => {
    tbody.appendChild(buildBulkItemRow(item, false, dataColumns));
  });

  table.appendChild(tbody);
  wrap.appendChild(table);

  // Update badge count
  const badge = safeGetElement('bulkEditCountBadge');
  if (badge) badge.textContent = bulkSelection.size + ' selected';

  // Async-load images for all rows now that they are in the DOM
  const allRows = [...pinnedItems, ...sortedFiltered];
  allRows.forEach(item => {
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
  const term = (bulkSearchTerm || '').toLowerCase().trim();
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
    filtered.forEach(item => bulkSelection.add(String(item.serial)));
  } else {
    // Deselect All: clear everything including pinned
    bulkSelection.clear();
  }
  renderBulkTableBody();
  renderBulkFooter();
};

const updateBulkSelectionUI = () => {
  // Update count badge
  const badge = safeGetElement('bulkEditCountBadge');
  if (badge) badge.textContent = bulkSelection.size + ' selected';

  // Targeted row updates via data-serial attribute
  const wrap = safeGetElement('bulkEditTableWrap');
  if (wrap) {
    const rows = wrap.querySelectorAll('tbody tr[data-serial]');
    rows.forEach(tr => {
      const serial = tr.getAttribute('data-serial');
      const isSelected = bulkSelection.has(serial);
      const cb = tr.querySelector('input[type="checkbox"]');

      if (isSelected) {
        tr.classList.add('bulk-edit-selected');
      } else {
        tr.classList.remove('bulk-edit-selected');
      }
      if (cb) cb.checked = isSelected;
    });

    // Update master checkbox — exclude pinned rows from the calculation
    const masterCb = wrap.querySelector('thead input[type="checkbox"]');
    if (masterCb) {
      const filteredRows = wrap.querySelectorAll('tbody tr[data-serial]:not(.bulk-edit-pinned)');
      const allSelected = filteredRows.length > 0 &&
        Array.from(filteredRows).every(tr => bulkSelection.has(tr.getAttribute('data-serial')));
      const someSelected = !allSelected &&
        Array.from(filteredRows).some(tr => bulkSelection.has(tr.getAttribute('data-serial')));
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
  const footer = safeGetElement('bulkEditFooter');
  if (!footer) return;

  while (footer.firstChild) footer.removeChild(footer.firstChild);

  const count = bulkSelection.size;
  const enabledCount = bulkEnabledFields.size;

  // Apply Changes button
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'btn btn-primary';
  applyBtn.textContent = 'Apply Changes' + (count ? ' (' + count + ')' : '');
  applyBtn.disabled = count === 0 || enabledCount === 0;
  applyBtn.title = count === 0 ? 'Select items first' : enabledCount === 0 ? 'Enable at least one field' : '';
  applyBtn.addEventListener('click', applyBulkEdit);
  footer.appendChild(applyBtn);

  // Copy Selected button
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn btn-secondary';
  copyBtn.textContent = 'Copy Selected' + (count ? ' (' + count + ')' : '');
  copyBtn.disabled = count === 0;
  copyBtn.addEventListener('click', copySelectedItems);
  footer.appendChild(copyBtn);

  // Delete Selected button (danger, pushed right)
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-danger';
  deleteBtn.textContent = 'Delete Selected' + (count ? ' (' + count + ')' : '');
  deleteBtn.disabled = count === 0;
  deleteBtn.addEventListener('click', deleteSelectedItems);
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
    var modal  = document.getElementById('bulkConfirmModal');
    var msgEl  = document.getElementById('bulkConfirmMessage');
    var okBtn  = document.getElementById('bulkConfirmOkBtn');
    var canBtn = document.getElementById('bulkConfirmCancelBtn');
    if (!modal || !okBtn || !canBtn) { resolve(false); return; }

    if (msgEl) msgEl.textContent = message;
    modal.style.display = 'flex';

    function cleanup(result) {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      canBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk()     { cleanup(true); }
    function onCancel() { cleanup(false); }

    okBtn.addEventListener('click', onOk);
    canBtn.addEventListener('click', onCancel);
  });
};

// =============================================================================
// BULK ACTIONS
// =============================================================================

const applyBulkEdit = async () => {
  const count = bulkSelection.size;
  const enabledCount = bulkEnabledFields.size;
  if (count === 0 || enabledCount === 0) return;

  // Collect current field values from inputs
  const valuesToApply = {};
  bulkEnabledFields.forEach(fieldId => {
    const input = safeGetElement('bulkFieldVal_' + fieldId);
    if (input) valuesToApply[fieldId] = input.value;
  });

  if (bulkEnabledFields.has('purity') && valuesToApply.purity === 'custom') {
    const purityCustomInput = safeGetElement('bulkFieldVal_purityCustom');
    const rawPurity = purityCustomInput ? purityCustomInput.value.trim() : '';
    const numericPurity = Number(rawPurity);

    if (!rawPurity || !Number.isFinite(numericPurity) || numericPurity < 0.001 || numericPurity > 1) {
      if (typeof showCloudToast === 'function') showCloudToast('Please enter a custom purity between 0.001 and 1 before applying bulk changes.');
      return;
    }

    // Keep the original string; coercion logic will normalize as needed.
    valuesToApply.purity = rawPurity;
  }

  // Convert gram weight to ozt for storage (matches parseWeight in events.js)
  if (bulkEnabledFields.has('weight') && valuesToApply.weight !== undefined) {
    const unitSelect = safeGetElement('bulkFieldVal_weightUnit');
    const effectiveUnit = valuesToApply.weightUnit || (unitSelect ? unitSelect.value : null);
    if (effectiveUnit === 'g') {
      const grams = parseFloat(valuesToApply.weight);
      if (!isNaN(grams)) {
        valuesToApply.weight = String(gramsToOzt(grams));
      }
    }
  }

  // When gb denomination mode is active, read weight from the denomination picker
  // (the hidden number input has stale/empty value).
  // Check both: explicit weightUnit in apply set, OR denomination picker visibly active.
  if (bulkEnabledFields.has('weight')) {
    const denomSelect = safeGetElement('bulkFieldVal_weightDenom');
    const unitSelect = safeGetElement('bulkFieldVal_weightUnit');
    const isGbMode = (valuesToApply['weightUnit'] === 'gb') ||
                     (unitSelect && unitSelect.value === 'gb');
    if (isGbMode && denomSelect && denomSelect.style.display !== 'none') {
      valuesToApply['weight'] = denomSelect.value;
    }
  }

  const fieldNames = [...bulkEnabledFields].map(id => {
    const def = BULK_EDITABLE_FIELDS.find(f => f.id === id);
    return def ? def.label : id;
  }).join(', ');

  if (!await showBulkConfirm('Apply ' + enabledCount + ' field(s) (' + fieldNames + ') to ' + count + ' item(s)?')) {
    return;
  }

  let updated = 0;
  inventory.forEach(item => {
    if (!bulkSelection.has(String(item.serial))) return;

    // Snapshot old item for change logging
    const oldItem = Object.assign({}, item);

    // Apply each enabled field
    Object.keys(valuesToApply).forEach(fieldId => {
      item[fieldId] = coerceFieldValue(fieldId, valuesToApply[fieldId]);
    });

    // STACK-62: Invalidate search cache for modified item
    if (typeof window.invalidateSearchCache === 'function') {
      window.invalidateSearchCache(item);
    }

    // Log changes for undo support
    if (typeof logItemChanges === 'function') {
      logItemChanges(oldItem, item);
    }

    updated++;
  });

  // Record price data points for bulk-edited items with price-related changes (STACK-43)
  if (typeof recordItemPrice === 'function') {
    const priceFields = ['price', 'marketValue', 'weight', 'weightUnit', 'qty', 'metal', 'purity'];
    if ([...bulkEnabledFields].some(id => priceFields.includes(id))) {
      inventory.forEach(item => {
        if (bulkSelection.has(String(item.serial))) recordItemPrice(item, 'bulk');
      });
      saveItemPriceHistory();
    }
  }

  // Persist and re-render
  if (typeof saveInventory === 'function') saveInventory();
  if (typeof renderTable === 'function') renderTable();
  if (typeof renderActiveFilters === 'function') renderActiveFilters();

  if (typeof showCloudToast === 'function') showCloudToast('Updated ' + updated + ' item(s).');

  // Refresh bulk table to reflect changes
  renderBulkTable();
  renderBulkFooter();
};

const copySelectedItems = async () => {
  const count = bulkSelection.size;
  if (count === 0) return;

  if (!await showBulkConfirm('Copy ' + count + ' item(s)? New copies will be added to your inventory.')) {
    return;
  }

  let copied = 0;
  const serialsToProcess = [...bulkSelection];

  serialsToProcess.forEach(serial => {
    const item = inventory.find(i => String(i.serial) === serial);
    if (!item) return;

    // Deep clone
    const clone = JSON.parse(JSON.stringify(item));
    clone.serial = getNextSerial();
    clone.uuid = generateUUID();

    inventory.push(clone);

    // Record initial price data point for the copy (STACK-43)
    if (typeof recordSingleItemPrice === 'function') {
      recordSingleItemPrice(clone, 'add');
    }

    // Log the copy
    if (typeof logChange === 'function') {
      logChange(clone.name, 'Copied', 'from serial ' + serial, 'new serial ' + clone.serial, inventory.length - 1);
    }

    copied++;
  });

  if (typeof saveInventory === 'function') saveInventory();
  if (typeof renderTable === 'function') renderTable();

  if (typeof showCloudToast === 'function') showCloudToast('Copied ' + copied + ' item(s).');

  renderBulkTable();
  renderBulkFooter();
};

const deleteSelectedItems = async () => {
  const count = bulkSelection.size;
  if (count === 0) return;

  if (!await showBulkConfirm('Delete ' + count + ' item(s)? You can undo deletions from the Change Log.')) {
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

  indicesToDelete.forEach(idx => {
    const item = inventory[idx];
    if (typeof logChange === 'function') {
      logChange(item.name, 'Deleted', JSON.stringify(item), '', idx);
    }
    inventory.splice(idx, 1);
  });

  // Clear deleted serials from selection
  indicesToDelete.forEach(() => {
    // Already spliced — remove from selection by checking what's left
  });
  const remaining = new Set(inventory.map(i => String(i.serial)));
  bulkSelection.forEach(s => {
    if (!remaining.has(s)) bulkSelection.delete(s);
  });

  if (typeof saveInventory === 'function') saveInventory();
  if (typeof renderTable === 'function') renderTable();
  if (typeof renderActiveFilters === 'function') renderActiveFilters();

  if (typeof showCloudToast === 'function') showCloudToast('Deleted ' + indicesToDelete.length + ' item(s).');

  renderBulkTable();
  renderBulkFooter();
};

// =============================================================================
// NUMISTA INTEGRATION
// =============================================================================

const triggerBulkNumistaLookup = async () => {
  if (!catalogAPI || !catalogAPI.activeProvider) {
    if (typeof showCloudToast === 'function') showCloudToast('Configure Numista API key in Settings first.');
    return;
  }

  // Set our callback — fillFormFromNumistaResult checks this before normal form fill
  window._bulkEditNumistaCallback = receiveBulkNumistaResult;

  // Prompt user for search query
  const query = typeof showAppPrompt === 'function'
    ? await showAppPrompt('Enter a coin name or Numista N# to search:', '', 'Numista Lookup')
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
        if (typeof showNumistaResults === 'function') {
          showNumistaResults(results, true, trimmed);
        }
      } else {
        results = await catalogAPI.searchItems(trimmed, { limit: 20 });
        if (typeof showNumistaResults === 'function') {
          showNumistaResults(results, false, trimmed);
        }
      }
    } catch (error) {
      console.error('Bulk Numista search error:', error);
      if (typeof showCloudToast === 'function') showCloudToast('Numista search failed: ' + error.message);
      window._bulkEditNumistaCallback = null;
    }
  })();
};

const receiveBulkNumistaResult = (fieldMap) => {
  if (!fieldMap || typeof fieldMap !== 'object') return;

  // Populate bulk edit field inputs and enable them
  Object.keys(fieldMap).forEach(fieldId => {
    const fieldDef = BULK_EDITABLE_FIELDS.find(f => f.id === fieldId);
    if (!fieldDef) return;

    const input = safeGetElement('bulkFieldVal_' + fieldId);
    const cb = safeGetElement('bulkField_' + fieldId);
    if (!input) return;

    if (fieldId === 'purity' && input.tagName === 'SELECT') {
      const optionExists = Array.from(input.options).some(option => option.value === String(fieldMap[fieldId]));
      input.value = optionExists ? String(fieldMap[fieldId]) : 'custom';
      const purityCustomInput = safeGetElement('bulkFieldVal_purityCustom');
      if (purityCustomInput && !optionExists) {
        purityCustomInput.value = String(fieldMap[fieldId]);
      }
      // Enable field and check checkbox before dispatching change event
      // so syncPurityState() sees the correct disabled state
      input.disabled = false;
      bulkFieldValues[fieldId] = fieldMap[fieldId];
      bulkEnabledFields.add(fieldId);
      if (cb) cb.checked = true;
      input.dispatchEvent(new Event('change'));
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

  // Clear the callback
  window._bulkEditNumistaCallback = null;
};

// =============================================================================
// IMAGE LOADING & UPLOAD
// =============================================================================

/**
 * Reads tableImageSides setting and returns which sides to display.
 * @returns {{ showObv: boolean, showRev: boolean }}
 */
const _getBulkImageSides = () => {
  const sides = localStorage.getItem('tableImageSides') || 'both';
  return {
    showObv: sides === 'both' || sides === 'obverse',
    showRev: sides === 'both' || sides === 'reverse',
  };
};

/**
 * Resolves IDB images for one item and injects <img> elements into its
 * IMG cell, replacing the placeholder. Respects tableImageSides setting.
 * Blob URLs are tracked in _bulkBlobUrls for cleanup on modal close.
 *
 * @param {HTMLTableRowElement} tr
 * @param {Object} item
 */
const _loadBulkRowImages = async (tr, item) => {
  const imgTd = tr.querySelector('.bulk-img-cell');
  if (!imgTd) return;

  // IDB unavailable (e.g. file:// protocol) — fall back to URL strings only
  if (!window.imageCache?.isAvailable()) {
    const { showObv, showRev } = _getBulkImageSides();
    imgTd.innerHTML = '';
    if (showObv && item.obverseImageUrl) {
      const img = document.createElement('img');
      img.src = item.obverseImageUrl; img.alt = ''; img.className = 'bulk-img-thumb'; img.dataset.side = 'obverse';
      img.onerror = () => { img.style.display = 'none'; };
      imgTd.appendChild(img);
    }
    if (showRev && item.reverseImageUrl) {
      const img = document.createElement('img');
      img.src = item.reverseImageUrl; img.alt = ''; img.className = 'bulk-img-thumb'; img.dataset.side = 'reverse';
      img.onerror = () => { img.style.display = 'none'; };
      imgTd.appendChild(img);
    }
    if (!imgTd.querySelector('img')) imgTd.innerHTML = '<span class="bulk-img-placeholder"></span>';
    return;
  }

  const { showObv, showRev } = _getBulkImageSides();

  // Resolve best source via the same cascade inventory table uses
  const resolved = await imageCache.resolveImageForItem(item);
  if (!tr.isConnected) return;

  /**
   * Get a URL for one side from the resolved source.
   * @param {'obverse'|'reverse'} side
   * @returns {Promise<string|null>}
   */
  const _getUrl = async (side) => {
    if (!resolved) {
      // Fall back to item.obverseImageUrl / item.reverseImageUrl strings
      return side === 'obverse' ? (item.obverseImageUrl || null) : (item.reverseImageUrl || null);
    }
    let url = null;
    if (resolved.source === 'user') {
      url = await imageCache.getUserImageUrl(item.uuid, side);
    } else if (resolved.source === 'pattern') {
      url = await imageCache.getPatternImageUrl(resolved.catalogId, side);
    } else if (resolved.source === 'numista') {
      url = await imageCache.getImageUrl(resolved.catalogId, side);
    }
    if (url) _bulkBlobUrls.add(url);
    return url;
  };

  const obvUrl = showObv ? await _getUrl('obverse') : null;
  const revUrl = showRev ? await _getUrl('reverse') : null;

  // Build replacement content
  imgTd.innerHTML = '';

  const _makeImg = (url, side) => {
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'bulk-img-thumb';
    img.dataset.side = side;
    if (url) {
      img.src = url;
      img.onerror = () => { img.style.display = 'none'; };
    } else {
      img.style.display = 'none';
    }
    return img;
  };

  const _makePh = () => {
    const ph = document.createElement('span');
    ph.className = 'bulk-img-placeholder';
    return ph;
  };

  const hasAny = obvUrl || revUrl;

  if (showObv) imgTd.appendChild(obvUrl ? _makeImg(obvUrl, 'obverse') : _makePh());
  if (showRev && (revUrl || (resolved && resolved.source === 'user'))) {
    imgTd.appendChild(revUrl ? _makeImg(revUrl, 'reverse') : _makePh());
  }

  if (!hasAny) {
    // Nothing resolved — ensure at least one placeholder is visible
    if (!imgTd.querySelector('.bulk-img-placeholder')) imgTd.appendChild(_makePh());
  }
};

/**
 * Opens a small inline image-management popover anchored to the IMG cell.
 * Lets the user upload obverse/reverse photos or remove existing ones for
 * a single item. Saves directly to imageCache and refreshes that row.
 *
 * @param {HTMLTableDataCellElement} imgTd
 * @param {Object} item
 */
const _openBulkImagePopover = (imgTd, item) => {
  // Remove any existing popover first
  const existing = document.getElementById('bulkImagePopover');
  if (existing) {
    existing.remove();
    // If clicking the same cell again, just close
    if (existing.dataset.forSerial === String(item.serial)) return;
  }

  const { showObv, showRev } = _getBulkImageSides();

  const pop = document.createElement('div');
  pop.id = 'bulkImagePopover';
  pop.className = 'bulk-img-popover';
  pop.dataset.forSerial = String(item.serial);

  const _sideHtml = (key, label) => `
    <div class="bulk-img-popover-side">
      <span class="bulk-img-popover-label">${label}</span>
      <div class="bulk-img-popover-preview" id="bulkPop${key}Preview"></div>
      <div class="bulk-img-popover-actions">
        <input type="file" id="bulkPop${key}File" accept="image/jpeg,image/png,image/webp" style="display:none" />
        <button class="btn btn-sm" id="bulkPop${key}Upload" type="button">Upload</button>
        <button class="btn btn-sm btn-danger" id="bulkPop${key}Remove" type="button" style="display:none">Remove</button>
      </div>
    </div>`;

  pop.innerHTML = `
    <div class="bulk-img-popover-header">
      <span class="bulk-img-popover-title">Photos</span>
      <button class="bulk-img-popover-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="bulk-img-popover-sides">
      ${showObv ? _sideHtml('Obv', 'Obverse') : ''}
      ${showRev ? _sideHtml('Rev', 'Reverse') : ''}
    </div>
  `;

  // Position below the cell
  document.body.appendChild(pop);
  const rect = imgTd.getBoundingClientRect();
  const popW = 260;
  // position: fixed — coords are viewport-relative, no scroll offset needed
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  let top = rect.bottom + 4;
  // Flip above cell if popover would overflow viewport bottom
  if (top + 280 > window.innerHeight) top = rect.top - 284;
  pop.style.top  = Math.max(4, top) + 'px';
  pop.style.left = Math.max(4, left) + 'px';

  // --- Close ---
  const closePopover = () => pop.remove();
  pop.querySelector('.bulk-img-popover-close').addEventListener('click', closePopover);
  const _outsideClick = (e) => {
    if (!pop.contains(e.target) && e.target !== imgTd) {
      closePopover();
      document.removeEventListener('click', _outsideClick, true);
    }
  };
  setTimeout(() => document.addEventListener('click', _outsideClick, true), 10);

  // --- Load existing images into previews ---
  const _loadPreview = async (previewEl, removeBtn, side) => {
    let url = null;
    let source = null;

    if (window.imageCache?.isAvailable()) {
      const rec = await imageCache.resolveImageForItem(item);
      source = rec?.source || null;
      if (source === 'user') {
        url = await imageCache.getUserImageUrl(item.uuid, side);
      } else if (source === 'pattern') {
        url = await imageCache.getPatternImageUrl(rec.catalogId, side);
      } else if (source === 'numista') {
        url = await imageCache.getImageUrl(rec.catalogId, side);
      }
    }

    if (!url) {
      url = side === 'obverse' ? (item.obverseImageUrl || null) : (item.reverseImageUrl || null);
    }
    if (!url && imgTd) {
      const rowThumb = imgTd.querySelector(`img.bulk-img-thumb[data-side="${side}"]`);
      if (rowThumb && rowThumb.src) {
        url = rowThumb.src;
      }
    }

    if (url) {
      _bulkBlobUrls.add(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = side;
      img.className = 'bulk-img-popover-img';
      img.onerror = () => { img.style.display = 'none'; };
      previewEl.innerHTML = '';
      previewEl.appendChild(img);

      // "Remove" only applies to user-uploaded images stored in userImages.
      removeBtn.style.display = source === 'user' ? '' : 'none';
    } else {
      previewEl.innerHTML = '<span class="thumb-popover-empty">No image</span>';
      removeBtn.style.display = 'none';
    }
  };

  const obvPreview  = pop.querySelector('#bulkPopObvPreview');
  const revPreview  = pop.querySelector('#bulkPopRevPreview');
  const obvRemove   = pop.querySelector('#bulkPopObvRemove');
  const revRemove   = pop.querySelector('#bulkPopRevRemove');

  if (showObv) _loadPreview(obvPreview, obvRemove, 'obverse');
  if (showRev) _loadPreview(revPreview, revRemove, 'reverse');

  // --- Upload handlers ---
  const _handleUpload = async (file, side) => {
    if (!file || typeof imageProcessor === 'undefined') return;
    const result = await imageProcessor.processFile(file, {
      maxDim:   typeof IMAGE_MAX_DIM   !== 'undefined' ? IMAGE_MAX_DIM   : 600,
      maxBytes: typeof IMAGE_MAX_BYTES !== 'undefined' ? IMAGE_MAX_BYTES : 512000,
    });
    if (!result?.blob) return;

    // Merge with existing (keep the other side if present)
    let obvBlob = side === 'obverse' ? result.blob : null;
    let revBlob = side === 'reverse' ? result.blob : null;
    try {
      const existing = await imageCache.getUserImage(item.uuid);
      if (existing) {
        if (!obvBlob && existing.obverse) obvBlob = existing.obverse;
        if (!revBlob && existing.reverse) revBlob = existing.reverse;
      }
    } catch (e) { /* ignore */ }

    if (!obvBlob && revBlob) { obvBlob = revBlob; revBlob = null; }

    await imageCache.cacheUserImage(item.uuid, obvBlob, revBlob);

    // Refresh the preview in the popover
    const previewEl = side === 'obverse' ? obvPreview : revPreview;
    const removeBtn = side === 'obverse' ? obvRemove  : revRemove;
    const previewUrl = URL.createObjectURL(result.blob);
    _bulkBlobUrls.add(previewUrl);
    previewEl.innerHTML = `<img src="${previewUrl}" alt="${side}" class="bulk-img-popover-img" />`;
    removeBtn.style.display = '';

    // Refresh the row thumbnail
    const tr = imgTd.closest('tr');
    if (tr) _loadBulkRowImages(tr, item);
  };

  const _wireUpload = (btnId, fileId, side) => {
    const btn  = pop.querySelector('#' + btnId);
    const file = pop.querySelector('#' + fileId);
    if (!btn || !file) return;
    btn.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { if (file.files[0]) _handleUpload(file.files[0], side); });
  };

  if (showObv) _wireUpload('bulkPopObvUpload', 'bulkPopObvFile', 'obverse');
  if (showRev) _wireUpload('bulkPopRevUpload', 'bulkPopRevFile', 'reverse');

  // --- Remove handlers ---
  const _handleRemove = async (side) => {
    if (!window.imageCache?.isAvailable()) return;
    const existing = await imageCache.getUserImage(item.uuid);
    if (!existing) return;

    const keepObv = side === 'reverse' ? existing.obverse : null;
    const keepRev = side === 'obverse' ? existing.reverse : null;

    if (!keepObv && !keepRev) {
      await imageCache.deleteUserImage(item.uuid);
    } else {
      const obvToSave = keepObv || keepRev;
      const revToSave = keepObv ? keepRev : null;
      await imageCache.cacheUserImage(item.uuid, obvToSave, revToSave);
    }

    const previewEl = side === 'obverse' ? obvPreview : revPreview;
    const removeBtn = side === 'obverse' ? obvRemove  : revRemove;
    previewEl.innerHTML = '<span class="thumb-popover-empty">No image</span>';
    removeBtn.style.display = 'none';

    const tr = imgTd.closest('tr');
    if (tr) _loadBulkRowImages(tr, item);
  };

  if (obvRemove) obvRemove.addEventListener('click', () => _handleRemove('obverse'));
  if (revRemove) revRemove.addEventListener('click', () => _handleRemove('reverse'));
};

// =============================================================================
// WINDOW EXPORTS
// =============================================================================

window.openBulkEdit = openBulkEdit;
window.closeBulkEdit = closeBulkEdit;

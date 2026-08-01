// ATTACHMENT UI — DOM rendering for per-item file attachments (STRK-45)
// =============================================================================
//
// CSS class manifest (matches playground/STRK-45-attachment-ui.html):
//   Queued row:   .attachment-item--queued  .attach-progress  .attach-progress-bar
//   Saved row:    .attachment-item  .attach-icon  .attach-icon--{pdf,png,jpg,file}
//                 .attach-info  .attach-name  .attach-meta  .attach-actions  .attach-btn
//   Missing row:  .attachment-item--missing  .attach-badge-warn
//   List:         .attachment-list
//   Card badge:   .cv-chip  .cv-chip-attach
//   Table badge:  .attach-count-chip
//   Panel:        .attach-panel  .attach-panel-header  .attach-panel-title
//                 .attach-panel-count  .attach-panel-body  .attach-panel-empty
//   Diff row:     .diff-attach-row  .diff-attach-row--{added,removed,changed}
//                 .diff-sign  .diff-sign--{added,removed,changed}
//                 .diff-attach-text  .diff-attach-meta  .diff-strikethrough  .diff-arrow

// ── SVG icons (static markup — safe for innerHTML assignment) ───────────────

const _SVG = {
  paperclip:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  paperclipSm:
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  paperclipLg:
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  warn: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  download:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  trash:
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  eye: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
};

// ── Private helpers ─────────────────────────────────────────────────────────

function _formatBytes(bytes) {
  if (!bytes || bytes < 1024) return (bytes || 0) + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function _fileIconInfo(mimeType, fileName) {
  const name = (fileName || "").toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf"))
    return { cls: "attach-icon--pdf", label: "PDF" };
  if (mimeType === "image/png" || name.endsWith(".png"))
    return { cls: "attach-icon--png", label: "PNG" };
  if (mimeType === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg"))
    return { cls: "attach-icon--jpg", label: "JPG" };
  return { cls: "attach-icon--file", label: "\u{1F4CE}" };
}

function _el(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function _iconBtn(classes, titleText, svgHtml) {
  const btn = _el("button", classes);
  btn.type = "button";
  btn.title = titleText;
  btn.innerHTML = svgHtml;
  return btn;
}

// ── File access helpers ─────────────────────────────────────────────────────

const _activeOpenUrls = new Set();
window.addEventListener("pagehide", () => {
  for (const u of _activeOpenUrls) URL.revokeObjectURL(u);
  _activeOpenUrls.clear();
});

async function _openAttachment(rec) {
  if (!window.attachmentManager?.isAvailable()) return;
  const stored = await window.attachmentManager.getAttachment(rec.attachmentUuid);
  if (!stored?.blob) return;
  const url = URL.createObjectURL(stored.blob);
  _activeOpenUrls.add(url);
  window.open(url, "_blank");
}

async function _downloadAttachment(rec) {
  if (!window.attachmentManager?.isAvailable()) return;
  const stored = await window.attachmentManager.getAttachment(rec.attachmentUuid);
  if (!stored?.blob) return;
  const url = URL.createObjectURL(stored.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = rec.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function _removeSavedAttachment(rec, item, onUpdate) {
  if (!item?.attachments) return;
  if (window.attachmentManager?.isAvailable()) {
    await window.attachmentManager.deleteAttachment(rec.attachmentUuid);
  }
  const idx = item.attachments.findIndex((a) => a.attachmentUuid === rec.attachmentUuid);
  if (idx !== -1) item.attachments.splice(idx, 1);
  if (typeof saveInventory === "function") saveInventory();
  if (typeof onUpdate === "function") {
    await onUpdate();
  } else {
    renderAttachmentSection(item);
  }
}

async function _getExistingAttachmentUuids(attachments) {
  const mgr = window.attachmentManager;
  if (!mgr?.isAvailable()) return null;
  try {
    if (typeof mgr.hasAttachments === "function") {
      return await mgr.hasAttachments(attachments.map((rec) => rec.attachmentUuid));
    }
    const existing = new Set();
    await Promise.all(
      attachments.map(async (rec) => {
        if (await mgr.hasAttachment(rec.attachmentUuid)) existing.add(rec.attachmentUuid);
      })
    );
    return existing;
  } catch (err) {
    console.warn("Attachment existence check failed:", err);
    return null;
  }
}

// ── Queued-row builder ──────────────────────────────────────────────────────

function _buildQueuedRow(entry) {
  const file = entry.file;
  const icon = _fileIconInfo(file.type, file.name);
  const li = _el("li", "attachment-item attachment-item--queued");
  li.dataset.attachmentEntryId = String(entry.id);

  const iconEl = _el("div", `attach-icon ${icon.cls}`);
  iconEl.textContent = icon.label;

  const info = _el("div", "attach-info");
  const nameEl = _el("div", "attach-name");
  nameEl.textContent = file.name;
  const metaEl = _el("div", "attach-meta");
  metaEl.textContent = `${_formatBytes(file.size)} · Queuing…`;
  const progress = _el("div", "attach-progress");
  const bar = _el("div", "attach-progress-bar");
  bar.style.width = "0%";
  progress.appendChild(bar);
  info.append(nameEl, metaEl, progress);

  const actions = _el("div", "attach-actions");
  const removeBtn = _iconBtn("attach-btn danger", "Remove", _SVG.trash);
  removeBtn.addEventListener("click", () => {
    if (typeof window.dequeueAttachment === "function") window.dequeueAttachment(entry.id);
  });
  actions.appendChild(removeBtn);

  li.append(iconEl, info, actions);
  return li;
}

// ── Saved-row builder ───────────────────────────────────────────────────────

function _buildSavedRow(rec, item, editable, onUpdate, isMissing) {
  const icon = _fileIconInfo(rec.type, rec.fileName);

  const li = _el("li", `attachment-item${isMissing ? " attachment-item--missing" : ""}`);
  li.dataset.attachmentUuid = rec.attachmentUuid;

  const iconEl = _el("div", `attach-icon ${icon.cls}`);
  if (isMissing) iconEl.style.opacity = "0.5";
  iconEl.textContent = icon.label;

  const info = _el("div", "attach-info");
  const nameEl = _el("div", "attach-name");
  if (isMissing) nameEl.style.opacity = "0.7";
  nameEl.textContent = rec.fileName;
  const metaEl = _el("div", "attach-meta");
  const dateStr = rec.uploadedAt ? rec.uploadedAt.slice(0, 10) : "";
  metaEl.textContent = `${_formatBytes(rec.size)} · Added ${dateStr}`;
  info.append(nameEl, metaEl);

  if (isMissing) {
    const warn = _el("span", "attach-badge-warn");
    warn.innerHTML = `${_SVG.warn} Binary missing`;
    const actions = _el("div", "attach-actions");
    const removeBtn = _iconBtn("attach-btn danger", "Remove", _SVG.trash);
    removeBtn.addEventListener("click", () => _removeSavedAttachment(rec, item, onUpdate));
    actions.appendChild(removeBtn);
    li.append(iconEl, info, warn, actions);
  } else {
    const actions = _el("div", "attach-actions");
    const openBtn = _iconBtn("attach-btn", "View/Open", _SVG.eye);
    openBtn.addEventListener("click", () => _openAttachment(rec));
    const dlBtn = _iconBtn("attach-btn", "Download", _SVG.download);
    dlBtn.addEventListener("click", () => _downloadAttachment(rec));
    actions.append(openBtn, dlBtn);
    if (editable) {
      const removeBtn = _iconBtn("attach-btn danger", "Remove", _SVG.trash);
      removeBtn.addEventListener("click", () => _removeSavedAttachment(rec, item, onUpdate));
      actions.appendChild(removeBtn);
    }
    li.append(iconEl, info, actions);
  }

  return li;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Re-renders #attachmentQueuedList with the current pending attachment entries.
 * Called by events.js whenever _pendingAttachments changes.
 * @param {{id:number, file:File}[]} entries
 */
function renderQueuedAttachments(entries) {
  const list = document.getElementById("attachmentQueuedList");
  if (!list) return;
  list.innerHTML = "";
  if (!entries || entries.length === 0) {
    list.hidden = true;
    return;
  }
  for (const entry of entries) list.appendChild(_buildQueuedRow(entry));
  list.hidden = false;
}

/**
 * Populates #attachmentSavedList with the item's saved attachment records.
 * Called by inventory.js when the edit modal opens for an item (single-arg call site).
 * @param {Object} item
 */
async function renderAttachmentSection(item) {
  const list = document.getElementById("attachmentSavedList");
  if (!list) return;
  list.innerHTML = "";
  if (typeof clearAttachmentQueue === "function") clearAttachmentQueue();

  const attachments = item?.attachments;
  if (!attachments || attachments.length === 0) {
    list.hidden = true;
    _notifyFormSection();
    return;
  }
  const existingUuids = await _getExistingAttachmentUuids(attachments);
  const onUpdate = () => renderAttachmentSection(item);
  for (const rec of attachments) {
    const isMissing = existingUuids ? !existingUuids.has(rec.attachmentUuid) : false;
    list.appendChild(_buildSavedRow(rec, item, /* editable */ true, onUpdate, isMissing));
  }
  list.hidden = false;
  _notifyFormSection();
}

/**
 * Tells the collapsible-section layer the attachment list just changed.
 * This renderer resolves an IndexedDB existence check before appending rows,
 * so it finishes AFTER the modal-open prepare pass — without this signal an
 * edited item's attachments neither auto-open their section nor badge
 * (STRK-301).
 */
function _notifyFormSection() {
  if (typeof refreshFormSectionData === "function") refreshFormSectionData("attachments");
}

/**
 * Returns an attachment count badge element, or null if the item has no attachments.
 * @param {Object} item
 * @param {{ variant?: 'card'|'table', onClick?: Function }} [options]
 * @returns {HTMLElement|null}
 */
function renderAttachmentBadge(item, options = {}) {
  const count = item?.attachments?.length || 0;
  if (count === 0) return null;

  const { variant = "card", onClick } = options;
  const el = _el("span", variant === "table" ? "attach-count-chip" : "cv-chip cv-chip-attach");
  el.title = `${count} attachment${count === 1 ? "" : "s"}`;
  el.innerHTML = _SVG.paperclipSm;
  el.appendChild(document.createTextNode(" " + count));

  if (onClick) {
    el.style.cursor = "pointer";
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(e);
    });
  }

  return el;
}

/**
 * Builds a standalone attachment panel element.
 * Used in viewModal (read-only by default); pass { editable: true } to enable removes.
 * @param {Object} item
 * @param {{ editable?: boolean }} [options]
 * @returns {Promise<HTMLElement>}
 */
async function renderAttachmentListPanel(item, options = {}) {
  const { editable = false } = options;
  const attachments = item?.attachments || [];

  const panel = _el("div", "attach-panel");

  const header = _el("div", "attach-panel-header");
  const titleGroup = _el("div", "attach-panel-title");
  titleGroup.innerHTML = _SVG.paperclip;
  titleGroup.appendChild(document.createTextNode(" Attachments"));
  if (attachments.length) {
    const countBadge = _el("span", "attach-panel-count");
    countBadge.textContent = String(attachments.length);
    titleGroup.appendChild(countBadge);
  }
  header.appendChild(titleGroup);
  panel.appendChild(header);

  if (attachments.length === 0) {
    const empty = _el("div", "attach-panel-empty");
    empty.innerHTML = _SVG.paperclipLg;
    empty.appendChild(document.createTextNode("No attachments"));
    panel.appendChild(empty);
  } else {
    const body = _el("div", "attach-panel-body");
    const list = _el("ul", "attachment-list");
    const onUpdate = async () => {
      panel.replaceWith(await renderAttachmentListPanel(item, options));
    };
    const existingUuids = await _getExistingAttachmentUuids(attachments);
    for (const rec of attachments) {
      const isMissing = existingUuids ? !existingUuids.has(rec.attachmentUuid) : false;
      list.appendChild(_buildSavedRow(rec, item, editable, onUpdate, isMissing));
    }
    body.appendChild(list);
    panel.appendChild(body);
  }

  return panel;
}

/**
 * Builds a diff row element for the DiffModal attachment change log.
 * @param {{ attachmentUuid?: string, fileName: string, type: string, size: number, uploadedAt?: string, oldFileName?: string }} entry
 * @param {'added'|'removed'|'replaced'} type
 * @returns {HTMLElement}
 */
function renderAttachmentDiffRow(entry, type) {
  // 'replaced' maps to the CSS --changed modifier (playground naming)
  const cssType = type === "replaced" ? "changed" : type;
  const signs = { added: "+", removed: "−", changed: "~" };
  const sign = signs[cssType] ?? "·";

  const row = _el("div", `diff-attach-row diff-attach-row--${cssType}`);
  if (entry.attachmentUuid) row.dataset.attachmentUuid = entry.attachmentUuid;

  const signEl = _el("span", `diff-sign diff-sign--${cssType}`);
  signEl.textContent = sign;

  const icon = _fileIconInfo(entry.type, entry.fileName);
  const iconEl = _el("div", `attach-icon ${icon.cls}`);
  iconEl.style.cssText = "width:22px;height:22px;font-size:9px;font-weight:700";
  iconEl.textContent = icon.label;

  const textGroup = _el("div", "diff-attach-text");

  const nameRow = _el("div");
  nameRow.style.cssText = "font-weight:500;font-size:var(--font-size-sm)";
  if (type === "replaced" && entry.oldFileName) {
    const oldSpan = _el("span", "diff-strikethrough");
    oldSpan.textContent = entry.oldFileName;
    const arrow = _el("span", "diff-arrow");
    arrow.textContent = "→";
    nameRow.append(oldSpan, arrow, document.createTextNode(entry.fileName));
  } else {
    nameRow.textContent = entry.fileName;
  }

  const metaEl = _el("div", "diff-attach-meta");
  const action = type === "added" ? "Added" : type === "removed" ? "Removed" : "Replaced";
  const dateStr = entry.uploadedAt ? entry.uploadedAt.slice(0, 10) : "";
  metaEl.textContent = `${_formatBytes(entry.size)} · ${action}${dateStr ? " " + dateStr : ""}`;

  textGroup.append(nameRow, metaEl);
  row.append(signEl, iconEl, textGroup);
  return row;
}

// ── Window exports ──────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.renderQueuedAttachments = renderQueuedAttachments;
  window.renderAttachmentSection = renderAttachmentSection;
  window.renderAttachmentBadge = renderAttachmentBadge;
  window.renderAttachmentListPanel = renderAttachmentListPanel;
  window.renderAttachmentDiffRow = renderAttachmentDiffRow;
}

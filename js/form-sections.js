// FORM SECTIONS — collapsible add/edit item form state (STRK-301)
//
// The sections themselves are native <details>/<summary>; nothing here is
// needed to open or close one. This module owns three things layered on top:
//
//   1. Remembered state — a per-section open/collapsed map persisted under
//      FORM_SECTION_STATE_KEY. Deliberately device-local: the key is in
//      ALLOWED_STORAGE_KEYS but NOT in SYNC_SCOPE_KEYS, because disclosure
//      preferences are a per-device ergonomic, not inventory data.
//   2. Precedence on modal open — a remembered explicit user choice wins;
//      otherwise a section already holding data opens (edit/clone); otherwise
//      the static markup default stands (Images and Constitutional ship with
//      the `open` attribute, everything else collapsed).
//   3. Count badges — a collapsed section with content shows how much it
//      holds in its .form-section-count pill, so remembered-closed can never
//      silently hide data.
//
// Persistence must record USER toggles only. `toggle` events fire (async)
// for programmatic `el.open = x` writes too, so every programmatic change
// goes through _setSectionOpen, which stamps data-prog-toggle for the
// listener to consume and skip.

const FORM_SECTION_KEYS = [
  "images",
  "constitutional",
  "grading",
  "marketPricing",
  "catalog",
  "notes",
  "attachments",
  "tags",
];

let _formSectionPersistReady = false;

/**
 * Returns the <details> element for a form section key.
 * @param {string} key - data-section key
 * @returns {HTMLElement|null} The section element, or null before DOM ready
 */
const _formSectionEl = (key) =>
  document.querySelector(`details.form-section[data-section="${key}"]`);

/**
 * Reads the persisted section-state map.
 * @returns {Object<string, boolean>} Map of section key to open state
 */
const _loadFormSectionState = () => {
  const raw =
    typeof loadDataSync === "function" ? loadDataSync(FORM_SECTION_STATE_KEY, null) : null;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
};

/**
 * Sets a section's open state programmatically without recording it as a
 * user choice. Stamps data-prog-toggle so the toggle listener skips the
 * (asynchronous) event this write queues. No-op when state already matches —
 * an unchanged .open fires no toggle event and the stamp would go stale.
 * @param {HTMLElement} el - The <details> section element
 * @param {boolean} open - Desired open state
 * @returns {void}
 */
const _setSectionOpen = (el, open) => {
  if (!el || el.open === open) return;
  el.dataset.progToggle = "1";
  el.open = open;
};

/**
 * Counts non-empty user-facing controls inside a section body. A number
 * input holding "0" counts as empty — 0 is the shipped placeholder value for
 * price fields, not user data.
 * @param {Element} body - The .form-section-body element
 * @returns {number} Filled-control count
 */
const _countFilledControls = (body) => {
  let filled = 0;
  body.querySelectorAll("input, select, textarea").forEach((el) => {
    const type = (el.type || "").toLowerCase();
    if (["hidden", "file", "checkbox", "radio", "button", "submit"].includes(type)) return;
    const value = (el.value || "").trim();
    if (!value) return;
    if (type === "number" && Number(value) === 0) return;
    // A select sitting on its first option is in its shipped default state,
    // not user data — every select in these section bodies leads with a
    // placeholder/none option. Without this, orientation/capsule defaults
    // count as content and pop Catalog Data open on a blank add form.
    if (el.tagName === "SELECT" && el.selectedIndex <= 0) return;
    filled += 1;
  });
  return filled;
};

/**
 * Computes how much content a section currently holds, from the live form
 * DOM rather than the item object — so the add, edit, and clone populate
 * paths all measure identically.
 * @param {string} key - data-section key
 * @returns {number} Content count for the badge (0 hides it)
 */
const _formSectionContentCount = (key) => {
  const el = _formSectionEl(key);
  const body = el ? el.querySelector(".form-section-body") : null;
  if (!body) return 0;
  switch (key) {
    case "images": {
      let previews = 0;
      ["itemImagePreviewObv", "itemImagePreviewRev"].forEach((id) => {
        const preview = document.getElementById(id);
        if (preview && preview.style.display !== "none") previews += 1;
      });
      return previews;
    }
    case "tags":
      return body.querySelectorAll(".tag-chip").length;
    case "attachments": {
      const queued = document.getElementById("attachmentQueuedList");
      const saved = document.getElementById("attachmentSavedList");
      return (queued ? queued.children.length : 0) + (saved ? saved.children.length : 0);
    }
    default:
      return _countFilledControls(body);
  }
};

/**
 * Recomputes every section's count badge. A collapsed section with content
 * must always advertise it (the no-silently-hidden-data guarantee), so this
 * runs on modal preparation and on every toggle.
 * @returns {void}
 */
const updateFormSectionBadges = () => {
  FORM_SECTION_KEYS.forEach((key) => {
    const el = _formSectionEl(key);
    const badge = el ? el.querySelector("summary .form-section-count") : null;
    if (!badge) return;
    const count = _formSectionContentCount(key);
    badge.textContent = count > 0 ? String(count) : "";
    badge.hidden = count === 0;
  });
};

/**
 * Applies the disclosure precedence to every section and refreshes badges.
 * Call after the form is populated, immediately before showing the modal —
 * the add, edit, and clone paths all route through here.
 *
 * Precedence per section: remembered explicit choice > content present in
 * the form (the on-edit auto-open) > static markup default.
 * @returns {void}
 */
const prepareFormSections = () => {
  const remembered = _loadFormSectionState();
  const staticDefaults = { images: true, constitutional: true };
  FORM_SECTION_KEYS.forEach((key) => {
    const el = _formSectionEl(key);
    if (!el) return;
    let open;
    if (typeof remembered[key] === "boolean") {
      open = remembered[key];
    } else if (_formSectionContentCount(key) > 0) {
      open = true;
    } else {
      open = Boolean(staticDefaults[key]);
    }
    _setSectionOpen(el, open);
  });
  updateFormSectionBadges();
};

/**
 * Opens one section programmatically — for fill paths (catalog lookup) that
 * write into a possibly-collapsed section and should surface the result.
 * Never recorded as a user choice.
 * @param {string} key - data-section key
 * @returns {void}
 */
const openFormSection = (key) => {
  _setSectionOpen(_formSectionEl(key), true);
  updateFormSectionBadges();
};

/**
 * Wires the capture-phase toggle listener that persists USER toggles and
 * keeps badges current. Capture because `toggle` does not bubble. Called
 * once from init.js after DOM ready.
 * @returns {void}
 */
const initFormSections = () => {
  if (_formSectionPersistReady) return;
  const form = document.getElementById("inventoryForm");
  if (!form) return;
  _formSectionPersistReady = true;
  form.addEventListener(
    "toggle",
    (event) => {
      const el = event.target;
      if (!el || !el.matches || !el.matches("details.form-section[data-section]")) return;
      // Badge state depends on disclosure only for freshness (collapse after
      // adding tags), so refresh on every toggle regardless of origin.
      updateFormSectionBadges();
      if (el.dataset.progToggle) {
        delete el.dataset.progToggle;
        return;
      }
      const state = _loadFormSectionState();
      state[el.dataset.section] = el.open;
      if (typeof saveDataSync === "function") {
        try {
          saveDataSync(FORM_SECTION_STATE_KEY, state);
        } catch (err) {
          console.warn("form-sections: could not persist section state", err);
        }
      }
    },
    true
  );
};

// Expose globals (script-tag architecture — no modules)
if (typeof window !== "undefined") {
  window.prepareFormSections = prepareFormSections;
  window.openFormSection = openFormSection;
  window.updateFormSectionBadges = updateFormSectionBadges;
  window.initFormSections = initFormSections;
}

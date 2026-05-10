// ABOUT TAB & ACKNOWLEDGMENT — Enhanced
// =============================================================================

const populateAboutTab = () => {
  const aboutVersion = safeGetElement("aboutVersion");
  const aboutCurrentVersion = safeGetElement("aboutCurrentVersion");
  const aboutAppName = safeGetElement("aboutAppName");

  if (aboutVersion && typeof APP_VERSION !== "undefined") {
    aboutVersion.textContent = `v${APP_VERSION}`;
  }

  if (aboutCurrentVersion && typeof APP_VERSION !== "undefined") {
    aboutCurrentVersion.textContent = `v${APP_VERSION}`;
  }

  if (aboutAppName) {
    const stakSpan = aboutAppName.querySelector(".stak");
    const trakrSpan = aboutAppName.querySelector(".trakr");
    if (stakSpan && trakrSpan) {
      const brand = getBrandingName();
      const split = BRANDING_DOMAIN_OPTIONS?.logoSplit?.[brand];
      stakSpan.textContent =
        Array.isArray(split) && split.length >= 2 ? split[0].toUpperCase() : "STAK";
      trakrSpan.textContent =
        Array.isArray(split) && split.length >= 2 ? split[1].toUpperCase() : "TRAKR";
    }
  }

  // Load announcements for latest changes and roadmap
  loadAnnouncements();
};

const loadAnnouncements = async () => {
  const whatsNewTargets = [document.getElementById("aboutChangelogLatest")].filter(Boolean);
  const roadmapTargets = [document.getElementById("aboutRoadmapList")].filter(Boolean);

  if (!whatsNewTargets.length && !roadmapTargets.length) return;

  // STAK-513: Use embedded content directly. The external docs/announcements.md
  // was deleted but CDN ghost caches serve stale copies indefinitely.
  // Embedded content is the single source of truth, maintained by /release.
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  whatsNewTargets.forEach((el) => {
    el.innerHTML = getEmbeddedWhatsNew();
  }); // developer-controlled HTML
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  roadmapTargets.forEach((el) => {
    el.innerHTML = getEmbeddedRoadmap();
  }); // developer-controlled HTML
};

const showFullChangelog = () => {
  // Try to open changelog documentation
  window.open(
    "https://github.com/lbruton/StakTrakr/blob/main/CHANGELOG.md",
    "_blank",
    "noopener,noreferrer"
  );
};

// STAK-547: Acknowledge version so toast doesn't show again
const acknowledgeVersion = () => {
  if (typeof APP_VERSION !== "undefined") {
    localStorage.setItem(VERSION_ACK_KEY, APP_VERSION);
  }
};

// STAK-547: Show latest changelog entry as a bottom-right toast card (replaces modal)
const showWhatsNewPopup = () => {
  // Prevent duplicate cards if called more than once
  if (document.querySelector(".whats-new-toast-card")) return;

  // Parse first entry from embedded list (developer-controlled HTML)
  const doc = new DOMParser().parseFromString(`<ul>${getEmbeddedWhatsNew()}</ul>`, "text/html");
  const firstLi = doc.querySelector("li");
  if (!firstLi) {
    acknowledgeVersion();
    return;
  }

  // Build card with DOM methods — no innerHTML on appended elements
  const label = document.createElement("span");
  label.className = "wntc-label";
  label.textContent = "What\u2019s New";

  const versionSpan = document.createElement("span");
  versionSpan.className = "wntc-version";
  versionSpan.textContent = typeof APP_VERSION !== "undefined" ? `v${APP_VERSION}` : "";

  const closeBtn = document.createElement("button");
  closeBtn.className = "wntc-close";
  closeBtn.setAttribute("type", "button");
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.textContent = "\u00D7";

  const header = document.createElement("div");
  header.className = "wntc-header";
  header.appendChild(label);
  header.appendChild(versionSpan);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "wntc-body";
  // Clone parsed li child nodes (developer-controlled, not user input)
  Array.from(firstLi.childNodes).forEach((node) => body.appendChild(node.cloneNode(true)));

  const card = document.createElement("div");
  card.className = "whats-new-toast-card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  card.appendChild(header);
  card.appendChild(body);
  document.body.appendChild(card);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    card.classList.add("fade-out");
    card.addEventListener("animationend", () => card.remove(), { once: true });
    acknowledgeVersion();
  };

  card.addEventListener("click", dismiss);
  const timer = setTimeout(dismiss, 4000);
};

// Kept for backward compat — removes toast card if present and acknowledges version
const hideWhatsNewPopup = () => {
  const card = document.querySelector(".whats-new-toast-card");
  if (card) card.remove();
  acknowledgeVersion();
};

// setupWhatsNewPopupEvents kept as no-op — modal removed (STAK-547)
const setupWhatsNewPopupEvents = () => {};

const getEmbeddedWhatsNew = () => {
  return `
    <li><strong>v3.34.56 &ndash; STRK-65: Attachment review follow-ups</strong>: Hardens per-item attachments after PR review &mdash; queue entries removable independently, object URL lifecycle fixed, cloud-sync pull helper extracted (fixes repeat downloads), size guard before vault serialization, DiffEngine duplicate-filename safety, split items keep attachments on both records, storage diagnostics clarified (STRK-65).</li>
    <li><strong>v3.34.55 &ndash; STRK-45: Per-item PDF/image attachments</strong>: Attach receipts, COAs, and dealer invoices directly to inventory items (PDF, PNG, JPG) from the Edit modal drag-drop zone. Attachments are persisted in IndexedDB, shown as a count badge on card, table, and detail views, included in zip/stvault backups and CSV exports, and synced via cloud sync with an opt-out toggle in Settings (STRK-45).</li>
    <li><strong>v3.34.54 &ndash; STRK-52: Numista re-sync tag membership</strong>: Existing on-item tags in the Numista re-sync picker are now shown checked and enabled instead of locked-disabled, letting you uncheck them to record an explicit opt-out. Uncheck-all also protects on-item tags from accidental mass-removal (STRK-52).</li>
    <li><strong>v3.34.53 &ndash; STRK-46: Structured Capsule field + capsule notes</strong>: Inventory items now have dedicated Capsule and Capsule Notes fields with Air-Tite-style suggestions, autocomplete, search/filter support, view-modal display, and JSON backup round-trip preservation (STRK-46).</li>
    <li><strong>v3.34.52 &ndash; STRK-54: Lost disposition realized loss</strong>: Partial-stack Lost dispositions now record the disposed units&rsquo; full cost basis as realized loss, keeping item-level and portfolio realized G/L totals aligned with full-stack lost items (STRK-54).</li>
    <li><strong>v3.34.51 &ndash; STRK-56: Service worker cache recovery</strong>: StakTrakr now falls back to cached app files when an asset refresh fails and offers Reset App recovery when stale service-worker state persists (STRK-56).</li>
    <li><strong>v3.34.50 &ndash; STRK-55: View modal respects per-item Numista edits</strong>: The item detail modal now shows your saved Numista customizations instead of only the shared catalog snapshot. Obverse and reverse descriptions are visible text rows in Catalog Data, and duplicate tags were removed from that section (STRK-55).</li>
    <li><strong>v3.34.49 &ndash; STRK-51: Expanded Numista import modal fields</strong>: The Numista import-confirmation modal now shows all 18 Numista-backed stored fields (dimensions, mintage, KM reference, rarity, commemorative, descriptions, etc.) alongside the existing 8. User-edited fields appear unchecked with an &ldquo;&#x270e;&nbsp;edited&rdquo; badge so re-syncs never silently overwrite custom values. The modal body scrolls on short viewports; Fill Fields/Cancel stay sticky (STRK-51).</li>
  `;
};

const getEmbeddedRoadmap = () => {
  return `
    <li><strong>Market Page Phase 3</strong>: Inventory-to-market linking with auto-update retail prices</li>
    <li><strong>Cloud Backup Conflict Detection (STAK-150)</strong>: Smarter conflict resolution using item count direction, not just timestamps</li>
  `;
};

// Expose globally for access from other modules
if (typeof window !== "undefined") {
  window.loadAnnouncements = loadAnnouncements;
  window.populateAboutTab = populateAboutTab;
  window.getEmbeddedWhatsNew = getEmbeddedWhatsNew;
  window.getEmbeddedRoadmap = getEmbeddedRoadmap;
  window.showFullChangelog = showFullChangelog;
  window.showWhatsNewPopup = showWhatsNewPopup;
  window.hideWhatsNewPopup = hideWhatsNewPopup;
  window.acknowledgeVersion = acknowledgeVersion;
  window.setupWhatsNewPopupEvents = setupWhatsNewPopupEvents;
}

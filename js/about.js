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
    <li><strong>v3.34.22 &ndash; STAK-570: Currency tab Goldback pricing redesign</strong>: Goldback pricing moved into Settings &gt; Currency with a single Off / API / Spot / Manual source selector, contextual inputs, a read-only denomination table, and the old Goldback settings tab removed.</li>
    <li><strong>v3.34.21 &ndash; STAK-439: Images tab redesign</strong>: Settings &gt; Images tab fully redesigned &mdash; Storage fieldset removed, Add Rule form collapses behind a &ldquo;+ New Rule&rdquo; pill button, styled upload buttons with image preview replace native file inputs, Edit form restyled to match Add form, flat Image Display grid, and solid pill buttons for proper dark mode contrast.</li>
    <li><strong>v3.34.20 &ndash; STAK-569: Fix Numista search metal prepend</strong>: Numista search no longer auto-prepends the metal dropdown value to the name query. Searches use exactly what you typed. Custom pattern rules still fire normally.</li>
    <li><strong>v3.34.19 &ndash; STAK-564: Move Force Refresh to About tab</strong>: Force Refresh relocated from Inventory tab to About tab as a compact Troubleshooting card. Button renamed to &ldquo;Clear Cache &amp; Reload&rdquo; with plain-language copy. App Updates fieldset removed from Inventory.</li>
    <li><strong>v3.34.18 &ndash; STAK-442: Move danger buttons from Storage to Inventory</strong>: &ldquo;Remove Inventory&rdquo; and &ldquo;Wipe All Data&rdquo; buttons moved from Settings &gt; Storage to Settings &gt; Inventory. All data management actions (import, export, backup, delete) are now in one tab. Storage is now pure diagnostics.</li>
    <li><strong>v3.34.17 &ndash; STAK-437: Remove Search tab, consolidate into Filters &amp; Search</strong>: The Search settings tab is gone — its controls (Fuzzy autocomplete and custom Numista Patterns) now live in the Filters &amp; Search tab. Built-in seed rules deleted; custom patterns are always-on. New users get an American Silver Eagle pattern pre-seeded.</li>
    <li><strong>v3.34.15 &ndash; STAK-562: Goldback and Silverback as first-class type</strong>: Goldback and Silverback are now first-class inventory types across Add, Edit, Bulk Edit, chips, and quick filters. Type options now follow metal selection rules (Gold &rarr; Goldback, Silver &rarr; Silverback), and backed notes render with a dedicated icon-first display in cards and table rows.</li>
    <li><strong>v3.34.14 &ndash; STAK-558: Comma and semicolon delimiters in tag input</strong>: Type or paste multiple tags separated by commas or semicolons in the Add a tag field — all tags are added at once. Empty tokens are skipped, whitespace is trimmed, and existing dedup/max-tag limits still apply per token.</li>
    <li><strong>v3.34.13 &ndash; STAK-556: Cherry-pick Numista tags + respect your edits</strong>: Numista search now uses per-tag checkboxes instead of all-or-none import; blacklisted and previously removed tags default unchecked, while edited fields can be restored by re-checking tagged values.</li>
  `;
};

const getEmbeddedRoadmap = () => {
  return `
    <li><strong>Settings Redesign (STAK-436&ndash;447)</strong>: 12-issue suite covering Appearance, Filters, and API settings tabs</li>
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

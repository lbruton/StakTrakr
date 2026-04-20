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
    <li><strong>v3.34.16 &ndash; STAK-436: Appearance tab realized toggle cleanup</strong>: The Realized G/L control now lives in the Layout card header as a Yes/No chip toggle, the empty Summary Totals card is gone, and the setting still persists and syncs on the existing key.</li>
    <li><strong>v3.34.15 &ndash; STAK-562: Goldback and Silverback as first-class type</strong>: Goldback and Silverback are now first-class inventory types across Add, Edit, Bulk Edit, chips, and quick filters. Type options now follow metal selection rules (Gold &rarr; Goldback, Silver &rarr; Silverback), and backed notes render with a dedicated icon-first display in cards and table rows.</li>
    <li><strong>v3.34.14 &ndash; STAK-558: Comma and semicolon delimiters in tag input</strong>: Type or paste multiple tags separated by commas or semicolons in the Add a tag field — all tags are added at once. Empty tokens are skipped, whitespace is trimmed, and existing dedup/max-tag limits still apply per token.</li>
    <li><strong>v3.34.13 &ndash; STAK-556: Cherry-pick Numista tags + respect your edits</strong>: Numista search now uses per-tag checkboxes instead of all-or-none import; blacklisted and previously removed tags default unchecked, while edited fields can be restored by re-checking tagged values.</li>
    <li><strong>v3.34.12 &ndash; STAK-556: Cherry-pick Numista tags + respect your edits</strong>: Numista search now lets you pick individual tags instead of importing all or none. Fields you&rsquo;ve manually edited default to unchecked with a &ldquo;&#x270E; edited&rdquo; hint. Tags you&rsquo;ve previously removed default to unchecked. Bulk sync warns before overwriting and offers a &ldquo;skip user-edited&rdquo; option.</li>
    <li><strong>v3.34.11 &ndash; STAK-554: No more unwanted Numista re-sync pop-up</strong>: Opening an inventory item with a Numista catalog ID no longer auto-triggers a re-sync prompt. Sync is now exclusively manual via Settings &rarr; API &rarr; &ldquo;Sync Metadata&rdquo; (batch) or Edit/Add &rarr; Numista search &rarr; &ldquo;Fill Fields&rdquo; (per-item). Also fixes item names containing quote characters (e.g., <code>&quot;American Silver Eagle&quot;</code>) that were rendering as literal <code>&amp;quot;</code> in the view modal.</li>
    <li><strong>v3.34.10 &ndash; STAK-553: Last Modified Sort + Sort Bar in Table View</strong>: Adds a <code>Last Modified</code> sort option to the live sort dropdown and default sort settings. Items now track a <code>lastModified</code> timestamp at create/edit time. The sort bar is now visible in table view (D mode). Selecting Last Modified auto-switches to descending order (newest first).</li>
    <li><strong>v3.34.09 &ndash; STAK-548 Hotfix: Home Poller Container Crash</strong>: Reverted a late shared-helper refactor that broke the home poller's dashboard and metrics containers (ERR_MODULE_NOT_FOUND on startup due to Dockerfile flattening <code>shared/*.js</code> into <code>/app/</code>). Internal infrastructure fix, no user-facing behavior change.</li>
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

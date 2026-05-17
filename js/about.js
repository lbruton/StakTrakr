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
    <li><strong>v3.34.70 &ndash; STRK-86: Search ignores Numista catalog data</strong>: Inventory search now matches against Numista-synced catalog fields (country, denomination, composition, technique, obverse/reverse/edge descriptions, KM reference) in addition to title and notes. Searching &ldquo;Australia&rdquo; now returns coins whose Country catalog field is Australia even when the title does not contain the word (STRK-86).</li>
    <li><strong>v3.34.69 &ndash; STRK-73: Configurable Disposition section</strong>: The Disposition section is now a draggable row in Settings &rarr; Appearance &rarr; Item Detail Modal; legacy configs auto-upgrade with Disposition appended last, and items without a valid disposition payload never render the section (STRK-73).</li>
    <li><strong>v3.34.68 &ndash; STRK-79: Market API service-worker routing</strong>: New <code>sw-router.js</code> classifier routes all StakTrakr API and spot-history requests through cache-first-with-TTL; per-family freshness windows use envelope <code>stale_after</code> when present, falling back to floor TTLs; 26 unit tests + 3 Playwright integration tests (STRK-79).</li>
    <li><strong>v3.34.67 &ndash; STRK-78: Playwright test suite mock audit and consolidation</strong>: New shared mock layer eliminates real external API calls across the Playwright test suite; 47 spec files migrated to deterministic fixtures with zero network dependency (STRK-78).</li>
    <li><strong>v3.34.66 &ndash; STRK-38: Rectangular item images auto-size in card/table views</strong>: Bars, notes, Goldbacks, and other rectangular items now render with transparent backgrounds, proper aspect-ratio sizing via object-fit: contain, and shape-aware SVG placeholders in card views (A/B/C) and the table view &mdash; matching the detail modal&rsquo;s existing behavior (STRK-38).</li>
    <li><strong>v3.34.65 &ndash; STRK-75: All tab as default in vendor price matrix</strong>: Adds an All tab as the first and default tab in the market price matrix; market-tracked metals appear grouped Gold &rarr; Silver &rarr; Platinum &rarr; Palladium &rarr; Goldback, while per-metal tabs and saved tab preferences are fully preserved (STRK-75).</li>
    <li><strong>v3.34.64 &ndash; STRK-50: Optional structured Payment Method dropdown</strong>: Adds an optional payment method selector that persists through edit, clone, bulk edit, import/export, backup, filtering, search, and item details without affecting valuation math (STRK-50).</li>
    <li><strong>v3.34.63 &ndash; STRK-71: Attachment chip in inline chip settings</strong>: The attachment count badge is now toggleable and reorderable in Settings &rarr; Appearance &rarr; Layout &rarr; Inline Name Chips, just like the other name-cell chips (STRK-71).</li>
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

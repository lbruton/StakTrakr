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
    <li><strong>v3.34.28 &ndash; STAK-576: AutoTable vendor fallback warning</strong>: PDF export support now recognizes the locally bundled AutoTable plugin correctly, preventing the false CDN fallback warning/request when offline-capable export code is already loaded.</li>
    <li><strong>v3.34.27 &ndash; STAK-576: Duplicate network fetch cleanup</strong>: Cold-load spot sync now shares in-flight provider/backfill work, exchange-rate refreshes dedupe within the startup burst, and the market vendor table reuses the retail cache instead of re-fetching each visible slug.</li>
    <li><strong>v3.34.26 &ndash; STAK-565: JM Bullion scraper column fix</strong>: Fixed JM Bullion price readings oscillating between the correct eCheck/Wire tier (~$86) and the wrong Card tier (~$95) depending on which scrape engine rendered the page. New pipe-table parser locates the (e)Check/Wire column by header label instead of relying on column order. Column-blind fallback removed — missed ticks preferred over wrong-tier prices.</li>
    <li><strong>v3.34.25 &ndash; STAK-573: API tab QA pass</strong>: Save buttons + masked key indicators on catalog cards, working Test endpoints for Numista and PCGS, usage bar fix, Bulk Sync modal consolidated from 4 tabs to 2, footer parity across spot cards, button color variants, modal width constrained.</li>
    <li><strong>v3.34.24 &ndash; STAK-443: Settings &gt; API tab redesign</strong>: Monolithic provider-tab panel replaced with three clean sectioned cards &mdash; Market Prices, Spot Price, Catalog. Spot Price uses a single-select pill radio (StakTrakr / Metals.dev / Metals-API / MetalPriceAPI / Custom / Manual); Manual mode is a full-offline replacement that disables all feeds. Numista + PCGS catalog controls moved to a focused Bulk Sync modal with 4 tabs.</li>
    <li><strong>v3.34.23 &ndash; STAK-446: Activity Log tab redesign</strong>: Activity Log sub-tabs renamed (Metals &rarr; Spot Price, Price History &rarr; Item History) and reordered by usage priority. Undo/redo now works for added items in the changelog.</li>
    <li><strong>v3.34.22 &ndash; STAK-570: Currency tab Goldback pricing redesign</strong>: Goldback pricing moved into Settings &gt; Currency with a single Off / API / Spot / Manual source selector, contextual inputs, a read-only denomination table, and the old Goldback settings tab removed.</li>
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

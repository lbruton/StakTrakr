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
    <li><strong>v3.34.42 &ndash; STRK-26: Cleaner card visuals</strong>: Removed decorative metal-color stripes from inventory cards in all three card layouts. Card C also lost a soft tinted glow on its image column. The cards now feel less &ldquo;templated&rdquo; and put more focus on your actual coin photos (STRK-26).</li>
    <li><strong>v3.34.41 &ndash; STRK-29: Monospace font consolidation</strong>: Added Geist Mono as the unified monospace font, replacing 6 inconsistent font stacks across CSS and JS. All monospace text now flows through a single <code>--font-mono</code> variable. Inline JS styles migrated to CSS classes (STRK-29).</li>
    <li><strong>v3.34.40 &ndash; Distinctive typography</strong>: Replaced the generic Inter font with Geist (body) and Instrument Serif (headings) &mdash; locally bundled, offline-ready, and tuned for dense data at 13px. The interface now feels like a precision instrument, not a template (STRK-24).</li>
    <li><strong>v3.34.39 &ndash; Market matrix alphabetical sorting</strong>: Vendor columns and item rows in the market price matrix now appear in alphabetical order by display name, eliminating layout drift between page loads (STRK-21).</li>
    <li><strong>v3.34.38 &ndash; Silverback as a first-class metal type</strong>: Silverbacks now have their own 0.001 troy ounce weight unit, separate from Goldback retail pricing. Existing records migrate automatically on load, import, and cloud restore. Denomination selector, purity default, and aria labels are all corrected (STRK-4, STRK-12, STRK-15, STRK-17).</li>
    <li><strong>v3.34.36 &ndash; Inventory data safety</strong>: Startup no longer overwrites your inventory with sample data when localStorage is missing or corrupt &mdash; a recovery banner appears instead. Re-importing your own encrypted backup no longer produces duplicates; items match by serial, Numista ID, or name+date before comparison (STRK-13, STRK-14).</li>
    <li><strong>v3.34.34 &ndash; Lot &harr; Each purchase price toggle</strong>: Enter a lot total when buying multiples &mdash; the app divides by quantity and stores a per-unit price. The Purchase column now shows the qty-multiplied total in the inventory table (STRK-4).</li>
    <li><strong>v3.34.24 &ndash; Settings tab overhaul</strong>: API tab redesigned with sectioned card layout. Search tab merged into Filters. Activity Log, Images, and Currency tabs redesigned. Danger buttons moved from Storage to Inventory. Force Refresh relocated to About (STAK-437, STAK-439, STAK-442, STAK-443, STAK-446, STAK-564).</li>
    <li><strong>v3.34.33 &ndash; Retail &amp; market improvements</strong>: Retail and market price surfaces now honor your selected display currency. Settings &rarr; API asks for confirmation before switching spot providers. Mobile action buttons clear Android gesture nav and iOS safe-area insets on all notched devices (STAK-571, STAK-578, STAK-581).</li>
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

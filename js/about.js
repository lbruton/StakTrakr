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
    <li><strong>v3.34.48 &ndash; STRK-47: Sort by Storage Location and Year</strong>: Added <em>Storage Location</em> and <em>Year</em> as sortable options in the card sort bar and Settings default sort selector. Year sorts numerically with missing values at the end; Storage Location sorts alphabetically.</li>
    <li><strong>v3.34.47 &ndash; STRK-44: Partial-stack disposition</strong>: Dispose fewer than the full stack quantity in one action &mdash; a Quantity field appears on the disposition modal when qty &gt; 1, with a Lot/Each Amount toggle and inline remaining-units preview. The original record decrements in place; a disposed clone is created adjacent carrying all metadata. The Activity Log records two correlated entries that undo atomically. Restoring a split-clone offers a Merge-or-Separate choice (STRK-44).</li>
    <li><strong>v3.34.46 &ndash; STRK-18: Vault settings parse helper</strong>: Encrypted vault restore preview now uses one shared helper to decompress and JSON-parse remote and local settings values before diffing, keeping raw-string fallback behavior intact while removing duplicated code in the settings comparison path (STRK-18).</li>
    <li><strong>v3.34.45 &ndash; STRK-25: New metallic dark theme + oklch token system</strong>: A new warm-gunmetal dark theme replaces the old Tailwind Slate look as the default dark option (Slate is preserved as a 4th theme). The light, dark, and sepia palettes are now in oklch for perceptual uniformity, with 26 new semantic tokens (text/focus/hover/tag/brand/authority/disposition/column) consumed across CSS and JS. Modal headers shifted from blue brand-gradient to flat panel-pattern; metal accent colors (silver/gold/platinum/palladium) tuned per theme so the metal-tinted gradients on the item view modal render correctly across all 4 themes (STRK-25).</li>
    <li><strong>v3.34.44 &ndash; STRK-27: CSS polish pass</strong>: Normalized border-radius tokens across the app &mdash; cards, pills, sliders, and inputs now use consistent semantic tokens instead of ad-hoc values. Reduced specificity debt by eliminating 21 <code>!important</code> declarations from the pill button block (STRK-27).</li>
    <li><strong>v3.34.42 &ndash; STRK-26: Cleaner card visuals</strong>: Removed decorative metal-color stripes from inventory cards in all three card layouts. Card C also lost a soft tinted glow on its image column. The cards now feel less &ldquo;templated&rdquo; and put more focus on your actual coin photos (STRK-26).</li>
    <li><strong>v3.34.41 &ndash; STRK-29: Monospace font consolidation</strong>: Added Geist Mono as the unified monospace font, replacing 6 inconsistent font stacks across CSS and JS. All monospace text now flows through a single <code>--font-mono</code> variable. Inline JS styles migrated to CSS classes (STRK-29).</li>
    <li><strong>v3.34.40 &ndash; Distinctive typography</strong>: Replaced the generic Inter font with Geist (body) and Instrument Serif (headings) &mdash; locally bundled, offline-ready, and tuned for dense data at 13px. The interface now feels like a precision instrument, not a template (STRK-24).</li>
    <li><strong>v3.34.39 &ndash; Market matrix alphabetical sorting</strong>: Vendor columns and item rows in the market price matrix now appear in alphabetical order by display name, eliminating layout drift between page loads (STRK-21).</li>
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

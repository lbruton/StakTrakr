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
    <li><strong>v3.34.63 &ndash; STRK-71: Attachment chip in inline chip settings</strong>: The attachment count badge is now toggleable and reorderable in Settings &rarr; Appearance &rarr; Layout &rarr; Inline Name Chips, just like the other name-cell chips (STRK-71).</li>
    <li><strong>v3.34.62 &ndash; STRK-53: Constrained quantity selector</strong>: Dispose modal now uses chip buttons (stacks &le; 8) or a native select (stacks &gt; 8) to make invalid quantities unreachable via the UI. Single-item stacks show a pre-selected, dimmed chip instead of hiding the control (STRK-53).</li>
    <li><strong>v3.34.61 &ndash; STRK-66: ¼ Goldback denomination (Idaho, g0.25)</strong>: Adds the 1/4 Goldback (1/4000 oz gold) as the ninth canonical denomination with correct label rendering in add/edit and bulk-edit dropdowns, slug resolution, poller publishing, and bounds-guard regex fix for decimal denomination suffixes (STRK-66).</li>
    <li><strong>v3.34.60 &ndash; STRK-68: Chart unit alignment for lot/each pricing</strong>: Purchase, melt, and retail chart lines now use consistent units based on the stored lot/each pricing choice; re-editing an item restores the toggle and lot-total price to the edit form (STRK-68).</li>
    <li><strong>v3.34.59 &ndash; STRK-69: Goldback daily retail chart history</strong>: Goldback denomination prices now keep one retail-history point per calendar day even when the vendor price is flat, and item detail charts use denomination retail values when stored market value is empty (STRK-69).</li>
    <li><strong>v3.34.58 &ndash; STRK-42: Chart viewport scaling</strong>: Item detail charts now fit the y-axis to visible purchase, melt, and retail lines with padding, fetch only needed bounded-range history, and keep sparse 1Y ranges anchored at the viewport start (STRK-42).</li>
    <li><strong>v3.34.57 &ndash; STRK-67: Per-side image frame override</strong>: Add Auto/Circle/Rectangle frame controls for obverse and reverse images so rectangular slabs, bars, notes, and similar media can be corrected while default shape detection stays automatic (STRK-67).</li>
    <li><strong>v3.34.56 &ndash; STRK-65: Attachment review follow-ups</strong>: Hardens per-item attachments after PR review &mdash; queue entries removable independently, object URL lifecycle fixed, cloud-sync pull helper extracted (fixes repeat downloads), size guard before vault serialization, DiffEngine duplicate-filename safety, split items keep attachments on both records, storage diagnostics clarified (STRK-65).</li>
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

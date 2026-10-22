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

  // Load announcements for latest changes
  loadAnnouncements();
};

const loadAnnouncements = () => {
  const whatsNewTargets = [document.getElementById("aboutChangelogLatest")].filter(Boolean);

  if (!whatsNewTargets.length) return;

  // STAK-513: Use embedded content directly. The external docs/announcements.md
  // was deleted but CDN ghost caches serve stale copies indefinitely.
  // Embedded content is the single source of truth, maintained by /release.
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  whatsNewTargets.forEach((el) => {
    el.innerHTML = getEmbeddedWhatsNew();
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
    <li><strong>v3.36.59 &ndash; STRK-451: Theme-aware retail vendor colors</strong>: Vendor colors now adjust for light, dark, slate and sepia, keeping vendor labels readable while preserving distinct identities. Market and retail charts also switch to the matching colors when you change themes, and unknown vendors use muted text (STRK-451).</li>
    <li><strong>v3.36.58 &ndash; STRK-444: Collection title image links</strong>: Custom Collections now accept a web image link on either title frame through the image options button. Swap links and uploaded images, remove either side, and carry the links through backups, exports and cloud sync (STRK-444).</li>
    <li><strong>v3.36.57 &ndash; STRK-446: Readable filter chips in every theme</strong>: Filter chip text now switches between black and white to whichever reads best on the chip colour, so the chip bar is readable in light, dark, slate and sepia. Before, every chip used black text, which almost disappeared on the darker chips in the light and sepia themes. Chips also recolour straight away when you change theme (STRK-446).</li>
    <li><strong>v3.36.56 &ndash; One image editor everywhere</strong>: Each Item image frame now has an image options button: paste an image link there, or turn off &ldquo;Use a matching pattern image&rdquo; so a name-matched pattern image no longer fills that Item (v3.36.56). In the Custom Collection builder, each Slot&rsquo;s small image takes the collection&rsquo;s Image shape (Round, Bar, Note or Slab, portrait or landscape) instead of always being a circle and shows the whole photo (v3.36.55). This builds on v3.36.52, where the Add/Edit Item modal and the Collection builder began sharing one image-frame editor: click a frame to upload or use &times; to remove, and neither one crops your photo. Portrait Bar and Note thumbnails in the table are rectangles at coin size instead of small pills, and the remove badge is readable in every theme (STRK-426, STRK-427, STRK-434, STRK-436, STRK-442, STRK-443).</li>
    <li><strong>v3.36.54 &ndash; Your data and artwork are safer</strong>: With StakTrakr open in two tabs, each tab now picks up the other&rsquo;s Collections changes as soon as they are saved, so a change in one tab no longer overwrites links, Collections or artwork saved in the other, and backups include artwork the other tab just replaced. A Collection builder left open keeps what you typed, and tells you if the other tab deleted that Collection. Artwork you upload or replace in one tab is also no longer deleted when the other tab shows that Collection; stale copies are only cleared by Remove, deleting the Collection, or Settings &rsaquo; Images (v3.36.53). This builds on v3.36.35&ndash;51: a build no longer deletes storage it doesn&rsquo;t recognise, so going back to an older build is safe as long as it is v3.36.35 or later (anything earlier can still wipe newer data such as Collections); Dropbox pre-sync backups restore again, and Settings &rsaquo; Images no longer lists live Collection artwork as orphaned (STRK-412, STRK-413, STRK-438, STRK-439, STRK-440).</li>
      `;
};

// Expose globally for access from other modules
if (typeof window !== "undefined") {
  window.loadAnnouncements = loadAnnouncements;
  window.populateAboutTab = populateAboutTab;
  window.getEmbeddedWhatsNew = getEmbeddedWhatsNew;
  window.showFullChangelog = showFullChangelog;
  window.showWhatsNewPopup = showWhatsNewPopup;
  window.hideWhatsNewPopup = hideWhatsNewPopup;
  window.acknowledgeVersion = acknowledgeVersion;
  window.setupWhatsNewPopupEvents = setupWhatsNewPopupEvents;
}

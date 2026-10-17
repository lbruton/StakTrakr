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
    <li><strong>v3.36.54 &ndash; Your data and artwork are safer</strong>: With StakTrakr open in two tabs, each tab now picks up the other&rsquo;s Collections changes as soon as they are saved, so a change in one tab no longer overwrites links, Collections or artwork saved in the other, and backups include artwork the other tab just replaced. A Collection builder left open keeps what you typed, and tells you if the other tab deleted that Collection. Artwork you upload or replace in one tab is also no longer deleted when the other tab shows that Collection; stale copies are only cleared by Remove, deleting the Collection, or Settings &rsaquo; Images (v3.36.53). This builds on v3.36.35&ndash;51: a build no longer deletes storage it doesn&rsquo;t recognise, so going back to an older build is safe as long as it is v3.36.35 or later (anything earlier can still wipe newer data such as Collections); Dropbox pre-sync backups restore again, and Settings &rsaquo; Images no longer lists live Collection artwork as orphaned (STRK-412, STRK-413, STRK-438, STRK-439, STRK-440).</li>
    <li><strong>v3.36.52 &ndash; One image editor everywhere</strong>: The Add/Edit Item modal and the Collection builder now share one image-frame editor. In both, click a frame to upload or use &times; to remove, and neither one crops your photo; in the Item modal you can also paste an image URL with the link icon. Portrait Bar and Note thumbnails in the table are rectangles at coin size instead of small pills, and the remove badge is readable in every theme (STRK-426, STRK-427, STRK-434, STRK-436).</li>
    <li><strong>v3.36.37&ndash;44 &ndash; A more capable Custom Collection builder</strong>: You can now insert and reorder Slots, set a Mintage for each Slot, add spec metadata plus obverse and reverse title images, and pick portrait or landscape for Bar and Note Collections. The builder keeps weight honest when the Item type is locked and rejects negative specs (STRK-389, STRK-391, STRK-395, STRK-396, STRK-422, STRK-424).</li>
    <li><strong>v3.36.40&ndash;42 &ndash; Retail value in Collections</strong>: The Collections Ledger has a Retail column, and gain/loss on owned Slots takes retail prices into account. Collection totals show retail value next to melt, and Item names stay readable on narrow tablets (STRK-382, STRK-423).</li>
    <li><strong>v3.36.49&ndash;50 &ndash; Duplicate Item keeps your catalog details</strong>: A duplicated item carries over everything on the Numista Data tab and remembers which fields you edited by hand, so a later Numista re-sync won&rsquo;t overwrite them (STRK-433, STRK-437).</li>
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

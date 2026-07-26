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
    <li><strong>v3.35.68 &ndash; STRK-271: Metal Ratios panel now opens from the spot cards</strong>: The Au:Ag, Au:Pt, and Au:Pd chips on the spot cards are now clickable (or press Enter when focused) and open the new Metal Ratios panel &mdash; live ratio, long-run mean, all-time percentile, trend tiles, and a full history chart back to 1968 &mdash; pre-selected on the pair you clicked. Switch pairs inside the panel, including Pt:Pd, without closing (STRK-271).</li>
    <li><strong>v3.35.67 &ndash; STRK-270: Metal Ratios panel component built</strong>: The shared Metal Ratios panel (STRK-268) now exists as a reusable component &mdash; pair switching across Au:Ag, Au:Pt, Au:Pd, and Pt:Pd, a live/last-close badge, a labeled 52-week position bar with all-time percentile, signed trend tiles, and a themable history chart with a long-run-mean reference (STRK-270). Still no visible entry point; the spot-card chips and standalone page that open it land in the next updates.</li>
    <li><strong>v3.35.66 &ndash; STRK-269: Metal-ratio statistics groundwork</strong>: Lays the computational foundation for the upcoming Metal Ratios panel (STRK-268) &mdash; the app can now build full historical ratio series (gold:silver back to 1968; gold:platinum, gold:palladium, and platinum:palladium back to 1990) and compute their long-run mean, median, all-time percentile, trailing session averages, and 52-week and all-time extremes (STRK-269). No visible UI yet; the panel itself arrives in an upcoming update.</li>
    <li><strong>v3.35.65 &ndash; Retail history summaries and longer chart ranges</strong>: The Retail View detail modal now offers 24H, 7D, 30D, 60D, and 90D controls, and Median, Low, High, and Spread update from the same valid observations shown in the selected chart window. The Vendor comparison table stays tied to the current snapshot, while longer chart ranges retain automatic backup-API failover (STRK-260).</li>
    <li><strong>v3.35.64 &ndash; Summit Metals prices restored to the retail matrix</strong>: Summit's product pages started showing a &ldquo;Sold out&rdquo; badge on a related-products carousel whenever any carousel item sold out, which falsely marked every Summit price as out of stock in the vendor table. Stock detection now trusts Summit's own buy-box &ldquo;In Stock, Ready to Ship&rdquo; marker, so Summit prices are back while genuinely sold-out products still show OOS correctly (STRK-251).</li>
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

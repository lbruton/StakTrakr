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
    <li><strong>v3.36.28 &ndash; Sort the Collections hub Ledger</strong>: Click a hub header to sort by Collection, Progress, Owned, Value (melt), or To complete; click again to reverse it. Keyboard controls and a mobile Sort menu keep the same choices available, while filters retain your selection and Album order stays unchanged (STRK-392).</li>
    <li><strong>v3.36.27 &ndash; Collections find the coins you entered in grams</strong>: An Item you entered in grams, milligrams, kilograms, pounds, or avoirdupois ounces now shows up as a match for its year Slot &mdash; before, a 31.1&nbsp;g Silver Eagle read &ldquo;Not owned&rdquo; even though you had it, and the link picker labelled its weight &ldquo;0.999984&nbsp;g&rdquo;. Nothing needs re-entering: your stored weights were always right, only the matching was wrong. The link picker also opens filtered to the Slot&rsquo;s year, with an All items chip to see everything (STRK-398).</li>
    <li><strong>v3.36.26 &ndash; Collections visibility follows Settings</strong>: Hiding Collections in Settings &gt; Layout now also removes Collection chips, membership details, and Open actions from Item View, so no disabled destination is offered. The Slot links remain stored safely, and re-enabling Collections brings the same Item memberships back (STRK-380).</li>
    <li><strong>v3.36.25 &ndash; Collections beta</strong>: Build custom checklists or browse the Silver Eagle Type 1 and Type 2 date runs, link Items to Slots, and switch between album and ledger views. Collection links, cover art, and Slot art travel through Cloud Sync and supported backups; imports and restores now report storage failures clearly, and Settings lets you turn Collections off (STRK-368, STRK-370, STRK-371, STRK-372, STRK-377).</li>
    <li><strong>v3.36.24 &ndash; The metal detail modal, redesigned</strong>: Clicking a metal on the dashboard used to open a pie chart. Across v3.36.13&ndash;23 it became a portfolio story &mdash; a value-over-time chart with melt, cost-basis, and spot lines, five KPI tiles (Cost Basis, Melt, Retail, Unrealized, Realized), By Metal / By Type and By Purchase Location breakdowns, and an Acquisitions ledger that opens any item. This final polish pass says <em>Acquisitions</em> everywhere it used to say &ldquo;Buys&rdquo;, stops the close button lighting up with a focus ring on open (it still does when you Tab to it), colors the Realized tile green or red by sign like the dashboard card, and adds a troy-versus-avoirdupois FAQ entry. A final review pass also fixes Escape closing both stacked windows, the page scrolling behind the modal after closing an item, and edits made from the item view not refreshing the modal (STRK-352, STRK-357, STRK-359, STRK-360, STRK-349, STRK-367).</li>
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

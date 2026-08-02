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
    <li><strong>v3.35.94 &ndash; STRK-327: The Best Price ticker keeps scrolling after you reload on another tab</strong>: The ticker across the top of the Dashboard could turn into a frozen row with a scrollbar under it instead of gliding along. It happened whenever the ticker was built while you were looking at a different tab &mdash; reload the page on Inventory or Market and click back to Dashboard, or change a Market setting and return, and there it sat, motionless. The cause was that the ticker works out how far to travel by measuring its own width, and anything on a tab you are not currently viewing measures as zero, so it quietly gave up and laid itself out flat. It now takes that measurement again the moment the Dashboard comes back on screen, so it starts scrolling on its own with no reload needed. Short tickers with only a few items are untouched: they still sit still and stay scrollable by hand, which is the deliberate layout added back in v3.35.86 for tickers too short to loop (STRK-327).</li>
    <li><strong>v3.35.93 &ndash; STRK-326: You can now hide whole tabs you don&rsquo;t use</strong>: Settings &rsaquo; Appearance &rsaquo; Layout has a new <strong>Tabs</strong> list where each tab has its own checkbox. Untick one and it disappears from the header nav and from the mobile bottom bar too, so if you never look at dealer prices you can put Market away entirely and get a tidier bar. Previously the only way to empty a tab was to untick the one section it contained, which left the tab button sitting there opening a blank page. The old <strong>Visible sections</strong> list has become <strong>Dashboard sections</strong> and now covers just the Dashboard tab &mdash; its up/down arrows used to shuffle entries between tabs you could never see at the same time, so moving Vendor Prices above your totals changed nothing on screen; ordering your spot cards, ticker, and totals still works exactly as it did. Dashboard itself is always visible, which means a bookmarked <em>#/market</em> link to a tab you have since hidden lands on Dashboard instead of an empty screen, and so does hiding the tab you happen to be looking at. Your existing choices carry over untouched, and Show Realized G/L is right where it was (STRK-326).</li>
    <li><strong>v3.35.92 &ndash; STRK-282: The app is now organised into tabs</strong>: Everything used to live on one long page that you scrolled through end to end &mdash; spot prices, then your totals, then the search bar, the inventory table, and the dealer price tables all stacked together. That page is now split across four tabs in the header: <strong>Dashboard</strong> for spot prices and your summary totals, <strong>Inventory</strong> for searching and your table, <strong>Market</strong> for dealer prices, and <strong>Collections</strong>, which is a placeholder for now. Nothing inside those areas changed &mdash; the same search, filters, chips, modals and columns behave exactly as before, they are simply grouped instead of stacked. Each tab has its own address, so <em>#/inventory</em> or <em>#/market</em> can be bookmarked or linked straight to the view you want, and on a phone the tabs move to a bar fixed at the bottom of the screen where your thumb already is. Two smaller touches came with it: the search bar and the inventory table now read as one continuous card rather than two panels with a gap between them, and the warning that appears when your inventory cannot be loaded now sits above the tabs so it stays visible no matter which one you are on &mdash; previously it would have been possible to land on Dashboard and never see it (STRK-282).</li>
    <li><strong>v3.35.91 &ndash; STRK-322: MintBuilder is now a fully registered vendor everywhere in the app</strong>: When MintBuilder joined the price tracker, it was wired into the data pipeline but never added to the app&rsquo;s own vendor list &mdash; so the price detail window&rsquo;s vendor legend skipped it, and a few views only knew its name thanks to a stopgap label fix. It is now registered alongside the other ten dealers with its proper name, a link to mintbuilder.com, and its own indigo chart colour, so the legend, history table columns, and charts all treat it as a first-class vendor. The published price feed also now carries MintBuilder&rsquo;s real display details instead of a grey placeholder, and new tests keep the app&rsquo;s vendor lists in lockstep, so a dealer can no longer be added to one list and missed in another (STRK-322).</li>
    <li><strong>v3.35.90 &ndash; STRK-301: The add/edit form folds away what you aren&rsquo;t using</strong>: The item form&rsquo;s optional blocks &mdash; Grading &amp; Certification, Market Pricing &amp; Details, Catalog Data, Notes, Attachments, and Tags &mdash; are now collapsible sections that start folded, and the Images block joins them starting open. On a phone this makes adding an item dramatically less scrolling, which was the most-requested cleanup from mobile users. The form remembers how you leave it on each device, and when you edit an item, any section that actually holds something &mdash; tags, notes, a cert number &mdash; opens on its own unless you&rsquo;ve deliberately kept it closed; a folded section with content always shows a count pill on its header, so nothing is ever silently hidden. Two labels also got clearer: the section is now titled <strong>Market Pricing &amp; Details</strong> and its price field reads <strong>Today&rsquo;s Market Price</strong> (STRK-301).</li>
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

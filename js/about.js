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
    <li><strong>v3.35.92 &ndash; STRK-282: The app is now organised into tabs</strong>: Everything used to live on one long page that you scrolled through end to end &mdash; spot prices, then your totals, then the search bar, the inventory table, and the dealer price tables all stacked together. That page is now split across four tabs in the header: <strong>Dashboard</strong> for spot prices and your summary totals, <strong>Inventory</strong> for searching and your table, <strong>Market</strong> for dealer prices, and <strong>Collections</strong>, which is a placeholder for now. Nothing inside those areas changed &mdash; the same search, filters, chips, modals and columns behave exactly as before, they are simply grouped instead of stacked. Each tab has its own address, so <em>#/inventory</em> or <em>#/market</em> can be bookmarked or linked straight to the view you want, and on a phone the tabs move to a bar fixed at the bottom of the screen where your thumb already is. Two smaller touches came with it: the search bar and the inventory table now read as one continuous card rather than two panels with a gap between them, and the warning that appears when your inventory cannot be loaded now sits above the tabs so it stays visible no matter which one you are on &mdash; previously it would have been possible to land on Dashboard and never see it (STRK-282).</li>
    <li><strong>v3.35.91 &ndash; STRK-322: MintBuilder is now a fully registered vendor everywhere in the app</strong>: When MintBuilder joined the price tracker, it was wired into the data pipeline but never added to the app&rsquo;s own vendor list &mdash; so the price detail window&rsquo;s vendor legend skipped it, and a few views only knew its name thanks to a stopgap label fix. It is now registered alongside the other ten dealers with its proper name, a link to mintbuilder.com, and its own indigo chart colour, so the legend, history table columns, and charts all treat it as a first-class vendor. The published price feed also now carries MintBuilder&rsquo;s real display details instead of a grey placeholder, and new tests keep the app&rsquo;s vendor lists in lockstep, so a dealer can no longer be added to one list and missed in another (STRK-322).</li>
    <li><strong>v3.35.90 &ndash; STRK-301: The add/edit form folds away what you aren&rsquo;t using</strong>: The item form&rsquo;s optional blocks &mdash; Grading &amp; Certification, Market Pricing &amp; Details, Catalog Data, Notes, Attachments, and Tags &mdash; are now collapsible sections that start folded, and the Images block joins them starting open. On a phone this makes adding an item dramatically less scrolling, which was the most-requested cleanup from mobile users. The form remembers how you leave it on each device, and when you edit an item, any section that actually holds something &mdash; tags, notes, a cert number &mdash; opens on its own unless you&rsquo;ve deliberately kept it closed; a folded section with content always shows a count pill on its header, so nothing is ever silently hidden. Two labels also got clearer: the section is now titled <strong>Market Pricing &amp; Details</strong> and its price field reads <strong>Today&rsquo;s Market Price</strong> (STRK-301).</li>
    <li><strong>v3.35.89 &ndash; STRK-320: The spot-card freshness colour catches up when you come back to the tab</strong>: The colour-coded &#8635; button introduced in v3.35.88 had one blind spot &mdash; it only recomputed its colour when something happened, like a sync finishing or the app starting up. Leave the tab open overnight with auto-refresh off and the button stayed green, telling you your prices were fresh when the app knew they were a day old. The icon now repaints itself the moment the tab becomes visible again, so the colour you see when you return always reflects the real age of your data. This rides the browser&rsquo;s own tab-visibility signal rather than a timer, so a hidden tab does no background work and nothing runs on an interval (STRK-320).</li>
    <li><strong>v3.35.88 &ndash; STRK-291: The refresh button on each spot card shows how current your prices are</strong>: The small &#8635; button on the Silver, Gold, Platinum and Palladium cards is now colour-coded by the age of your price data &mdash; <strong>green</strong> under an hour old, <strong>amber</strong> between an hour and a day, <strong>red</strong> beyond that &mdash; and it updates the instant a sync finishes. Until now that button looked exactly the same whether you had synced a minute ago or last month, so the only way to tell was to read the timestamp under each card. Two cases are handled deliberately rather than by raw age. If you use an API provider that caches prices, a price sitting a few hours old but still inside its cache window shows green, because the app is not going to refetch it and calling it stale would be misleading. And a brand-new install that has never synced reads amber, not red &mdash; red is reserved for prices genuinely known to be over a day old, so the app does not greet you with an alarm colour. Note this is a different question from the one the API health panel answers: this button is about how current the data in <em>your</em> browser is, while that panel is about whether the price feed itself is still publishing, and the two keep separate thresholds on purpose. Every colour was measured against its background rather than judged by eye, which turned up two that fell short for icon legibility &mdash; amber in Light and Sepia, and green in Sepia, which was too pale against the sepia card &mdash; and both were darkened (STRK-291).</li>
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

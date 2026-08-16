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
    <li><strong>v3.36.9 &ndash; STRK-345: The copper price archive gets its missing months</strong>: Copper&rsquo;s day-by-day price archive on the StakTrakr feed previously began the day copper went live &mdash; requests for any earlier day came back empty, even though the daily history existed in the app&rsquo;s bundled data. A new maintenance tool now fills the archive back to late March 2026, matching the other four metals, using the same daily history that powers the long-range charts. Each backfilled day is honest about its resolution: one daily price point, clearly marked as a single sample rather than invented hourly data. Future metals get this backfill as a standard rollout step so the gap never recurs (STRK-345).</li>
    <li><strong>v3.36.8 &ndash; STRK-344: Copper&rsquo;s 90-day chart backfills for existing users</strong>: The v3.36.7 fix gave copper its first week of hourly history, but on long-standing profiles the 90-day and 180-day views still ran out of road &mdash; the deep history was sitting in the app&rsquo;s bundled seed data the whole time, and the code that hands seed history to charts only ever ran for brand-new profiles. That hand-off is now made per metal: any metal missing older history &mdash; like copper on a profile from before it existed &mdash; receives its bundled history automatically on the next load, with your live recorded prices always taking precedence. Between the two fixes, enabling a new metal now fills in its complete chart history on every profile, new or old (STRK-344).</li>
    <li><strong>v3.36.7 &ndash; STRK-343: Copper charts now fill in for existing users</strong>: If you enabled copper on a profile you&rsquo;d been using for a while, its little price chart likely drew flat while gold and silver charted fine &mdash; the app decided it was &ldquo;already caught up&rdquo; by looking at your existing metals and never fetched copper&rsquo;s first week of hourly history. That check is now made per metal: any metal missing recent history triggers the full seven-day pull, so copper&rsquo;s chart fills itself in on the next price sync with no action needed. Fresh installs were never affected, and any future metal we add will inherit the fix automatically (STRK-343).</li>
    <li><strong>v3.36.6 &ndash; STRK-341: The Silver-to-Copper ratio joins the ratios toolkit</strong>: The ratio widget now tracks Ag:Cu &mdash; how many ounces of copper one ounce of silver buys (around 157 right now) &mdash; alongside the classic gold-to-silver ratio and the platinum-group pairs. It appears in the ratios panel and on the full <em>/ratios/</em> page for everyone, and as a chip on the copper spot card for those who have switched copper on in Settings &rarr; Metal Order; if copper is off, no copper figure appears anywhere on your dashboard. The historical chart is honest about its sources: copper&rsquo;s deep history before 2013 is monthly, so the early years show real monthly points rather than invented daily ones (STRK-341).</li>
    <li><strong>v3.36.5 &ndash; STRK-306: Copper arrives on the dashboard</strong>: The final piece of copper support &mdash; a copper spot price card and a copper summary card, off by default and switched on in Settings &rarr; Appearance &rarr; Metal Order. The spot card quotes copper the way the copper market does, in dollars per pound (about $6), with the per-troy-ounce figure a hover away on the price itself &mdash; a forty-one-cent number next to gold&rsquo;s four thousand would look broken, even though that per-ounce value is exactly what&rsquo;s stored and used for your melt math. Enabling copper also reflows the dashboard: six summary cards fit in one row on desktop, and a dollar figure too long for its row now slides onto its own right-aligned line instead of being cut off with &ldquo;&hellip;&rdquo; &mdash; a six-figure portfolio stays fully readable. On phones your first-ordered metal now gets the full-width top slot. Leave copper off and nothing changes at all. One small default: the All Metals card now leads the summary row for new users &mdash; your own saved order is untouched (STRK-306).</li>
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

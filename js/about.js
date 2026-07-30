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
    <li><strong>v3.35.84 &ndash; STRK-299/300: Constitutional silver leads with face value, and the silver figure is called ASW</strong>: The Weight column for constitutional silver rows (junk silver) now reads <strong>$6.00 fv</strong> &mdash; the total face value of the lot &mdash; rather than the derived silver ounces. Face value is how these coins are quoted, bought and talked about, and the table was the one place that did not lead with it; the card views and the item detail window already did. The silver content moves to the cell tooltip along with the worn/fresh basis, and it now has a proper name: <strong>ASW</strong>, or Actual Silver Weight, the term dealers use when quoting bags. The app used ASW internally but never showed it, and the three places displaying that number each called it something different. The detail window also stops labelling a dollar amount as a &ldquo;Weight&rdquo; &mdash; it says <strong>Face value</strong>, with the ASW on its own row below. Sorting and filtering are unchanged: the Weight column still ranks by silver content so these rows interleave correctly with your bullion, which is why $1.00 of war nickels (20 coins) sits above $1.20 of 90% dimes (12 coins). Melt values, weight totals and CSV exports are identical, and face value is never currency-converted (STRK-299, STRK-300).</li>
    <li><strong>v3.35.83 &ndash; STRK-316: Goldbacks sort and filter by the gold they actually hold</strong>: Sorting your inventory by Weight put Goldbacks in the wrong place entirely &mdash; a 5 Goldback ranked as though it weighed 5 troy ounces, landing between a 10 oz bar and a 2 oz round instead of down near the bottom where it belongs. A 5 Goldback holds 0.005 ozt of gold. The same mix-up meant clicking Weight on a 2 Goldback note also pulled in your 2.00 oz rounds, because both were filed under &ldquo;2&rdquo;. Goldbacks and Silverbacks now sort and filter on the metal they actually contain, so they rank below your bullion and a Weight click selects only that denomination &mdash; while the chip above the table still reads &ldquo;5 gb&rdquo; rather than a string of decimal places. Your melt values, weight totals and CSV exports are untouched; only the row order and what a Weight click selects have changed (STRK-316).</li>
    <li><strong>v3.35.82 &ndash; STRK-315: The sync popup really stops appearing now</strong>: Last release chased this same bug into the catalog API settings, but the setting actually changing was the other one &mdash; your spot price API config. It keeps a private tally of how many price requests each device has made, tucked in beside the API keys, and the free built-in StakTrakr feed refreshes on every app launch. So the tally ticked up on each device every time you opened StakTrakr, even if you have never entered an API key at all, and Review Sync Changes opened to report it. Those tallies are now ignored when deciding whether settings changed, while the quota limits you set yourself still sync. That row is also renamed <strong>Spot API Config</strong> &mdash; it always covered your selected feed, cache timing and per-metal choices too, not just keys &mdash; and the matched settings listed at the bottom of that window, which used to show blank values and a stray &ldquo;not set&rdquo; for keys you definitely had, now show what they actually hold (STRK-315).</li>
    <li><strong>v3.35.81 &ndash; STRK-313: Cloud sync stops crying wolf about your catalog API key</strong>: If you sync between two devices or sites, the Review Sync Changes window kept insisting your Numista key had changed &mdash; &ldquo;configured &rarr; configured&rdquo; &mdash; when it never had. The culprit was an internal counter of catalog lookups stored next to the key, ticking up separately on each device. Sync now ignores those counters when deciding whether settings changed, so the popup only appears for a genuine key, token, or quota change, and switching between synced sessions is noticeably calmer (STRK-313).</li>
    <li><strong>v3.35.80 &ndash; The header is now a single clean row</strong>: Eight buttons have left the top of the screen. Every one of them duplicated something you could already reach elsewhere, and each has moved to where it belongs: <strong>Backup</strong> and <strong>Restore</strong> to <strong>Settings &rsaquo; System</strong>, which holds the full import and export surface, <strong>Cloud Sync</strong> to <strong>Settings &rsaquo; Cloud</strong>, <strong>Info</strong> to <strong>Settings &rsaquo; About</strong>, and <strong>Currency</strong> to <strong>Settings &rsaquo; Currency &rsaquo; Display currency</strong>. <strong>Trend</strong> and <strong>Spot Sync</strong> moved down onto the spot cards themselves &mdash; the period chip and the refresh icon on each card do the same job closer to the prices they affect. You will notice the currency one most, since it was the only button visible by default. Nothing you could do before has been taken away, and the header keeps <strong>Theme</strong> and <strong>Settings</strong> (STRK-283 to STRK-289, STRK-298).</li>
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

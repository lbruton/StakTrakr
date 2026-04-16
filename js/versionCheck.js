/**
 * Version change detection and changelog display
 */

/**
 * Compares stored version with current and shows changelog modal if needed
 */
const checkVersionChange = () => {
  const hasData = !!localStorage.getItem(LS_KEY);
  if (!hasData) {
    if (typeof window !== "undefined" && typeof window.debugLog === "function")
      window.debugLog("versionCheck: no inventory data, skipping");
    return;
  }

  const acknowledged = localStorage.getItem(VERSION_ACK_KEY);
  const current = APP_VERSION;
  if (typeof window !== "undefined" && typeof window.debugLog === "function") {
    window.debugLog(
      `versionCheck: ack=${acknowledged}, current=${current}, APP_VERSION=${APP_VERSION}`
    );
  }
  if (acknowledged === current) return;

  if (typeof window !== "undefined" && typeof window.debugLog === "function") {
    window.debugLog(`versionCheck: mismatch — showing What's New popup`);
  }
  if (typeof showWhatsNewPopup === "function") {
    showWhatsNewPopup();
  }
};

/**
 * Compares two BRANCH.RELEASE.PATCH version strings
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {number} Negative if a < b, 0 if equal, positive if a > b
 */
const compareVersions = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/**
 * Renders the version badge in the footer
 * @param {HTMLElement} badge - The badge element
 * @param {string} remoteVersion - Latest remote version
 * @param {string} releaseUrl - URL to latest release
 */
const renderVersionBadge = (badge, remoteVersion, releaseUrl) => {
  if (!badge) return;
  const val = safeGetElement("versionBadgeValue");
  if (compareVersions(remoteVersion, APP_VERSION) <= 0) {
    if (val) {
      val.textContent = `v${APP_VERSION} \u2714`;
      val.className = "shield-badge-value shield-badge-value--green";
    }
    badge.removeAttribute("href");
    badge.removeAttribute("target");
  } else {
    if (val) {
      val.textContent = `v${remoteVersion} available`;
      val.className = "shield-badge-value shield-badge-value--orange";
    }
    badge.href = releaseUrl;
    badge.target = "_blank";
    badge.rel = "noopener";
  }
  badge.style.display = "";
};

/** @constant {string} GITHUB_RELEASES_URL - Fallback link for static version badge */
const GITHUB_RELEASES_URL = "https://github.com/lbruton/StakTrakr/releases/latest";

/**
 * Shows a static version badge linking to GitHub releases.
 * Used as the default state; upgraded by checkRemoteVersion() when possible.
 */
const showStaticVersionBadge = () => {
  const badge = document.getElementById("versionBadge");
  if (!badge) return;
  const val = safeGetElement("versionBadgeValue");
  if (val) {
    val.textContent = `v${APP_VERSION}`;
    val.className = "shield-badge-value shield-badge-value--grey";
  }
  badge.href = GITHUB_RELEASES_URL;
  badge.target = "_blank";
  badge.rel = "noopener";
  badge.style.display = "";
};

/**
 * Checks for a newer version from the remote version.json endpoint (STACK-67)
 * Skips fetch on file:// protocol (static badge still shown). Caches result for 24 hours.
 */
const checkRemoteVersion = async () => {
  // Always show static badge first as the baseline
  showStaticVersionBadge();

  try {
    // Cannot fetch remote on file:// — keep static badge
    if (window.location.protocol === "file:") return;

    const badge = document.getElementById("versionBadge");
    if (!badge) return;

    // Check 24hr TTL cache
    const lastCheck = localStorage.getItem(LAST_VERSION_CHECK_KEY);
    const cachedVersion = localStorage.getItem(LATEST_REMOTE_VERSION_KEY);
    const cachedUrl = localStorage.getItem(LATEST_REMOTE_URL_KEY);
    if (lastCheck && cachedVersion && Date.now() - Number(lastCheck) < VERSION_CHECK_TTL) {
      renderVersionBadge(badge, cachedVersion, cachedUrl || "");
      return;
    }

    // Fetch with 5s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(VERSION_CHECK_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return;

    const data = await res.json();
    const remoteVersion = data.version;
    const releaseUrl = data.releaseUrl || "";
    if (!remoteVersion) return;

    // Cache result
    localStorage.setItem(LAST_VERSION_CHECK_KEY, String(Date.now()));
    localStorage.setItem(LATEST_REMOTE_VERSION_KEY, remoteVersion);
    localStorage.setItem(LATEST_REMOTE_URL_KEY, releaseUrl);

    renderVersionBadge(badge, remoteVersion, releaseUrl);
  } catch (_) {
    // Silent fail — static badge remains visible
  }
};

document.addEventListener("DOMContentLoaded", checkVersionChange);
document.addEventListener("DOMContentLoaded", checkRemoteVersion);

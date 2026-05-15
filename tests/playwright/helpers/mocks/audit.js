/**
 * Network mock audit policy for StakTrakr Playwright tests.
 *
 * Documents which external hosts are allowed/denied during test runs.
 * The deny-list audit catch-all in routes.js references this policy.
 */

// External hosts that are MOCKED (intercepted by page.route)
const MOCKED_HOSTS = [
  "api.staktrakr.com",
  "api2.staktrakr.com",
  "open.er-api.com",
  "cdn.jsdelivr.net",
  "www.staktrakr.com",
  "img.shields.io",
];

// External hosts that are ALLOWED (intentionally hit during tests)
// Currently none — all external traffic should be mocked or denied.
const ALLOWED_HOSTS = [];

// External hosts that are DENIED (any request here fails the test)
const DENIED_HOSTS = [
  // Cloud providers — only hit when cloud sync is explicitly enabled
  "api.dropboxapi.com",
  "content.dropboxapi.com",
  "api.box.com",
  "api.pcloud.com",
  // Catalog APIs — only hit when catalog credentials are configured
  "api.numista.com",
  "www.pcgs.com",
  // Dealer sites — retail scraping happens in pollers, not browser tests
  "herobullion.com",
  "apmex.com",
  "bullionexchanges.com",
  "goldback.com",
  "jmbullion.com",
  // Analytics / misc
  "www.google-analytics.com",
  "www.redditstatic.com",
];

function hostMatches(hostname, configuredHost) {
  return hostname === configuredHost || hostname.endsWith(`.${configuredHost}`);
}

/**
 * Check if a URL matches the deny list.
 * @param {string} url
 * @returns {boolean}
 */
function isDenied(url) {
  try {
    const hostname = new URL(url).hostname;
    return DENIED_HOSTS.some((h) => hostMatches(hostname, h));
  } catch {
    return false;
  }
}

/**
 * Check if a URL matches the allowed list.
 * @param {string} url
 * @returns {boolean}
 */
function isAllowed(url) {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_HOSTS.some((h) => hostMatches(hostname, h));
  } catch {
    return false;
  }
}

/**
 * Check if a URL is mocked.
 * @param {string} url
 * @returns {boolean}
 */
function isMocked(url) {
  try {
    const hostname = new URL(url).hostname;
    return MOCKED_HOSTS.some((h) => hostMatches(hostname, h));
  } catch {
    return false;
  }
}

export { MOCKED_HOSTS, ALLOWED_HOSTS, DENIED_HOSTS, isDenied, isAllowed, isMocked };

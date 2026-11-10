// Byparr sidecar client — FlareSolverr-compatible API
// =====================================================
// Communicates with the Byparr sidecar (image pinned in docker-compose.home.yml).
// Container name: staktrakr-byparr (set in docker-compose.home.yml).
//
// Endpoint (verified 2026-03-10 against live bullionexchanges.com):
//   POST /v1
//   Body:    { "cmd": "request.get", "url": "https://...", "max_timeout": 20 }
//   Byparr reads only snake_case max_timeout, in seconds; maxTimeout (ms) is kept
//   for FlareSolverr compatibility.
//   Returns: { "status": "ok", "solution": {
//               "cookies": [{ "name": "cf_clearance", "value": "..." }, ...],
//               "userAgent": "<ua-string>" }}
//   Health:  GET /health → { "msg": "Byparr is working!", "version": "..." }
//
// Override URL via CF_CLEARANCE_SIDECAR_URL env var.
// Docs: https://github.com/ThePhaseless/Byparr

// Accept both SIDECAR_URL (canonical) and SCRAPER_URL (legacy Fly.io secret)
const CF_CLEARANCE_SIDECAR_URL =
  process.env.CF_CLEARANCE_SIDECAR_URL ??
  process.env.CF_CLEARANCE_SCRAPER_URL ??
  "http://staktrakr-byparr:8191";
const CF_CLEARANCE_ENABLED = process.env.CF_CLEARANCE_ENABLED ?? "1";
import {
  extractJsonLdAvailability,
  extractJsonLdScriptsFromHtml,
  JSONLD_OOS_VALUES,
} from "./price-extract-shared.js";

const CF_CLEARANCE_TIMEOUT_MS = process.env.CF_CLEARANCE_TIMEOUT_MS ?? "20000";

// STRK-106: Byparr returns Playwright's HTML at the `load` event, before React
// hydration finishes. Heavier vendor pages (Bullion Exchanges gold in particular)
// frequently snapshot a 25–54KB shell missing the price grid — ~60% of attempts
// in burst testing, ~26% in production — versus the ~92KB hydrated page.
// Byparr reports HTTP 200 every time, so the only signal of a thin response is
// inspecting the HTML.
//
// isUsableByparrHtml decides whether a response is loaded; thin responses are
// retried. Every host needs CF_CLEARANCE_MIN_DOLLARS dollar amounts. Hosts in
// HYDRATION_MARKERS also need their price-table marker, because a site-wide
// ticker can reach the dollar count on a page with no product price. A page
// that JSON-LD marks out of stock has no price table and is usable as is.
const _rawMaxAttempts = Number(process.env.CF_CLEARANCE_MAX_ATTEMPTS ?? "6");
const CF_CLEARANCE_MAX_ATTEMPTS =
  Number.isFinite(_rawMaxAttempts) && _rawMaxAttempts > 0 ? _rawMaxAttempts : 6;
// No new attempt starts once this much time has passed since the first one.
const _rawBudget = Number(process.env.CF_CLEARANCE_BUDGET_MS ?? "60000");
const CF_CLEARANCE_BUDGET_MS = Number.isFinite(_rawBudget) && _rawBudget > 0 ? _rawBudget : 60000;
const _rawMinDollars = Number(process.env.CF_CLEARANCE_MIN_DOLLARS ?? "6");
const CF_CLEARANCE_MIN_DOLLARS =
  Number.isFinite(_rawMinDollars) && _rawMinDollars >= 0 ? _rawMinDollars : 6;
const _rawRetryDelay = Number(process.env.CF_CLEARANCE_RETRY_DELAY_MS ?? "1000");
const CF_CLEARANCE_RETRY_DELAY_MS =
  Number.isFinite(_rawRetryDelay) && _rawRetryDelay >= 0 ? _rawRetryDelay : 1000;

// Match $NNN.NN price tokens with optional thousands separators (e.g. $1,234.56).
// Allows whitespace between `$` and digits to catch inline HTML where currency
// and amount are split into separate spans.
const DOLLAR_TOKEN_RE = /\$\s*[0-9]{1,5}(?:,[0-9]{3})*\.[0-9]{2}/g;

function countDollarTokens(html) {
  if (!html) return 0;
  const matches = html.match(DOLLAR_TOKEN_RE);
  return matches ? matches.length : 0;
}

// Host (without "www.") → text that only the loaded price table contains.
// Bullion Exchanges renders its quantity-tier table client-side; its metals
// ticker holds a price and a daily change per metal on every page.
const HYDRATION_MARKERS = {
  "bullionexchanges.com": /\(E\)check\s*\/\s*Wire/i,
};

/**
 * Price-table marker for a URL's host, or null when the host has none.
 * @param {string} url - Vendor product URL.
 * @returns {RegExp|null}
 */
function hydrationMarkerFor(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  return HYDRATION_MARKERS[host] ?? null;
}

/**
 * Whether JSON-LD in the HTML marks the product out of stock.
 * @param {string} html - Byparr `solution.response`.
 * @returns {boolean}
 */
function isJsonLdOutOfStock(html) {
  const availability = extractJsonLdAvailability(extractJsonLdScriptsFromHtml(html));
  return JSONLD_OOS_VALUES.has(availability);
}

/**
 * Whether Byparr HTML holds a loaded product page: enough dollar amounts and,
 * for hosts in HYDRATION_MARKERS, the price-table marker or a JSON-LD
 * out-of-stock flag.
 * @param {string} url - Vendor product URL the HTML came from.
 * @param {string|null} html - Byparr `solution.response`.
 * @returns {boolean}
 */
export function isUsableByparrHtml(url, html) {
  if (countDollarTokens(html) < CF_CLEARANCE_MIN_DOLLARS) return false;
  const marker = hydrationMarkerFor(url);
  if (!marker || marker.test(html)) return true;
  return isJsonLdOutOfStock(html);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single Byparr fetch attempt. Returns { ok, data, errorMsg, timedOut }; timedOut
 * is true when the poller or Byparr ran out of time on the page.
 */
async function fetchByparrOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${CF_CLEARANCE_SIDECAR_URL}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "request.get",
        url,
        maxTimeout: timeoutMs,
        max_timeout: Math.ceil(timeoutMs / 1000),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        errorMsg: `HTTP ${response.status}: ${text.slice(0, 120)}`,
        // Byparr answers 408 when its own max_timeout runs out; an uncaught
        // Playwright timeout surfaces with its "Timeout Nms exceeded" message.
        timedOut: response.status === 408 || /\bTimeout \d+(?:\.\d+)?ms exceeded/.test(text),
      };
    }
    const data = await response.json();
    if (data.status !== "ok" || !data.solution) {
      return {
        ok: false,
        errorMsg: `unexpected response shape: ${JSON.stringify(data).slice(0, 200)}`,
      };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, errorMsg: err.message, timedOut: err.name === "AbortError" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Harvest a cf_clearance cookie (and pre-fetched HTML) from the Byparr sidecar.
 *
 * Retries up to CF_CLEARANCE_MAX_ATTEMPTS times when Byparr returns thin HTML
 * (isUsableByparrHtml is false) or the page load times out. Other
 * network and HTTP failures return null for the caller's fallback chain. No
 * attempt starts after CF_CLEARANCE_BUDGET_MS.
 *
 * @param {string} url - Vendor product URL to solve CF challenge for
 * @param {{ budgetMs?: number, now?: () => number }} [opts] - Time budget and clock.
 * @returns {Promise<{ cfClearance: string|null, userAgent: string, responseHtml: string|null } | null>}
 *   Returns solution on success (cfClearance may be null if Cloudflare didn't
 *   set a cookie, but responseHtml may still contain usable page content).
 *   Returns null only if disabled or sidecar unavailable.
 */
export async function getCFClearanceCookie(url, opts = {}) {
  if (CF_CLEARANCE_ENABLED !== "1") {
    return null;
  }

  const timeoutMs = Number(CF_CLEARANCE_TIMEOUT_MS);
  const budgetMs = opts.budgetMs ?? CF_CLEARANCE_BUDGET_MS;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  let lastResult = null;

  for (let attempt = 1; attempt <= CF_CLEARANCE_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1 && now() - startedAt >= budgetMs) {
      console.warn(`[cf-clearance] time budget ${budgetMs}ms spent after ${attempt - 1} attempts`);
      break;
    }
    const { ok, data, errorMsg, timedOut } = await fetchByparrOnce(url, timeoutMs);
    if (!ok) {
      console.warn(`[cf-clearance] sidecar error (attempt ${attempt}): ${errorMsg}`);
      // A timed-out snapshot is an independent draw, so it is worth another try.
      // Other failures return null for the caller's fallback chain.
      if (!timedOut) return null;
      continue;
    }

    const cookies = Array.isArray(data.solution?.cookies) ? data.solution.cookies : [];
    const cfCookie = cookies.find((c) => c.name === "cf_clearance");
    const responseHtml = data.solution.response ?? null;
    const dollarCount = countDollarTokens(responseHtml);
    const usable = isUsableByparrHtml(url, responseHtml);
    const markerNote =
      !usable && dollarCount >= CF_CLEARANCE_MIN_DOLLARS ? ", no price-table marker" : "";

    lastResult = {
      cfClearance: cfCookie?.value ?? null,
      userAgent: data.solution.userAgent,
      // HTML Byparr already fetched — lets caller skip a second browser request
      responseHtml,
    };

    // Quality check: is the rendered HTML usable, or did we snapshot before
    // hydration finished? Retry up to MAX_ATTEMPTS on thin HTML.
    if (usable) {
      if (attempt > 1) {
        console.log(
          `[cf-clearance] attempt ${attempt}/${CF_CLEARANCE_MAX_ATTEMPTS}: ` +
            `usable HTML (${dollarCount} price tokens, len=${responseHtml?.length ?? 0})`
        );
      }
      break;
    }

    if (attempt < CF_CLEARANCE_MAX_ATTEMPTS) {
      console.warn(
        `[cf-clearance] attempt ${attempt}/${CF_CLEARANCE_MAX_ATTEMPTS}: ` +
          `thin HTML (${dollarCount} price tokens${markerNote}, len=${responseHtml?.length ?? 0}) — ` +
          `retrying after ${CF_CLEARANCE_RETRY_DELAY_MS}ms`
      );
      await sleep(CF_CLEARANCE_RETRY_DELAY_MS);
    } else {
      console.warn(
        `[cf-clearance] all ${CF_CLEARANCE_MAX_ATTEMPTS} attempts returned ` +
          `thin HTML (${dollarCount} price tokens${markerNote}) — returning best-effort response`
      );
    }
  }

  // Even if the final attempt was thin, return what we have — the caller may
  // still extract a price via JSON-LD, or its own fallback chain handles the
  // miss. Pre-retry behavior was to return a thin response without inspection.
  if (!lastResult) return null;

  if (!lastResult.cfClearance) {
    if (lastResult.responseHtml) {
      console.log(
        "[cf-clearance] no cookie, but have response HTML — returning for direct extraction"
      );
    } else {
      console.warn("[cf-clearance] no cf_clearance cookie and no response HTML");
      return null;
    }
  }

  return lastResult;
}

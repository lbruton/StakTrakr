// Byparr sidecar client — FlareSolverr-compatible API
// =====================================================
// Communicates with ghcr.io/thephaseless/byparr:latest.
// Container name: staktrakr-byparr (set in docker-compose.home.yml).
//
// Endpoint (verified 2026-03-10 against live bullionexchanges.com):
//   POST /v1
//   Body:    { "cmd": "request.get", "url": "https://...", "maxTimeout": 30000 }
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
const CF_CLEARANCE_TIMEOUT_MS = process.env.CF_CLEARANCE_TIMEOUT_MS ?? "30000";

// STRK-106: Byparr returns Playwright's HTML at the `load` event, before React
// hydration finishes. Heavier vendor pages (Bullion Exchanges gold in particular)
// frequently snapshot a 25–54KB shell missing the price grid — ~60% of attempts
// in burst testing, ~26% in production — versus the ~92KB hydrated page.
// Byparr reports HTTP 200 every time, so the only signal of a thin response is
// inspecting the HTML.
//
// Heuristic: count dollar amounts in the HTML. Full BE product pages contain
// 9+ price tokens (single-unit + tier pricing); shells contain 0–4 (mostly
// header tickers). When below threshold, retry the Byparr call. This is
// vendor-agnostic — other Byparr-protected vendors with the same hydration
// race benefit too.
const _rawMaxAttempts = Number(process.env.CF_CLEARANCE_MAX_ATTEMPTS ?? "3");
const CF_CLEARANCE_MAX_ATTEMPTS =
  Number.isFinite(_rawMaxAttempts) && _rawMaxAttempts > 0 ? _rawMaxAttempts : 3;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single Byparr fetch attempt. Returns { ok, data, errorMsg } so the retry
 * loop can branch cleanly without nesting try/catch per iteration.
 */
async function fetchByparrOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${CF_CLEARANCE_SIDECAR_URL}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: timeoutMs }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        errorMsg: `HTTP ${response.status}: ${text.slice(0, 120)}`,
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
    return { ok: false, errorMsg: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Harvest a cf_clearance cookie (and pre-fetched HTML) from the Byparr sidecar.
 *
 * Retries up to CF_CLEARANCE_MAX_ATTEMPTS times when Byparr returns thin HTML
 * (fewer than CF_CLEARANCE_MIN_DOLLARS dollar tokens) — symptomatic of the
 * React hydration race documented in STRK-106. Network errors and HTTP
 * failures are NOT retried here; the caller's existing fallback chain handles
 * those.
 *
 * @param {string} url - Vendor product URL to solve CF challenge for
 * @returns {Promise<{ cfClearance: string|null, userAgent: string, responseHtml: string|null } | null>}
 *   Returns solution on success (cfClearance may be null if Cloudflare didn't
 *   set a cookie, but responseHtml may still contain usable page content).
 *   Returns null only if disabled or sidecar unavailable.
 */
export async function getCFClearanceCookie(url) {
  if (CF_CLEARANCE_ENABLED !== "1") {
    return null;
  }

  const timeoutMs = Number(CF_CLEARANCE_TIMEOUT_MS);
  let lastResult = null;

  for (let attempt = 1; attempt <= CF_CLEARANCE_MAX_ATTEMPTS; attempt++) {
    const { ok, data, errorMsg } = await fetchByparrOnce(url, timeoutMs);
    if (!ok) {
      console.warn(`[cf-clearance] sidecar error (attempt ${attempt}): ${errorMsg}`);
      // Network / shape failures don't benefit from immediate retry — return
      // null so the caller falls through to its existing fallback chain.
      return null;
    }

    const cookies = Array.isArray(data.solution?.cookies) ? data.solution.cookies : [];
    const cfCookie = cookies.find((c) => c.name === "cf_clearance");
    const responseHtml = data.solution.response ?? null;
    const dollarCount = countDollarTokens(responseHtml);

    lastResult = {
      cfClearance: cfCookie?.value ?? null,
      userAgent: data.solution.userAgent,
      // HTML Byparr already fetched — lets caller skip a second browser request
      responseHtml,
    };

    // Quality check: is the rendered HTML usable, or did we snapshot before
    // hydration finished? Retry up to MAX_ATTEMPTS on thin HTML.
    if (dollarCount >= CF_CLEARANCE_MIN_DOLLARS) {
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
          `thin HTML (${dollarCount} price tokens, len=${responseHtml?.length ?? 0}) — ` +
          `retrying after ${CF_CLEARANCE_RETRY_DELAY_MS}ms`
      );
      await sleep(CF_CLEARANCE_RETRY_DELAY_MS);
    } else {
      console.warn(
        `[cf-clearance] all ${CF_CLEARANCE_MAX_ATTEMPTS} attempts returned ` +
          `thin HTML (${dollarCount} price tokens) — returning best-effort response`
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

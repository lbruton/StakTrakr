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
  process.env.CF_CLEARANCE_SIDECAR_URL ?? process.env.CF_CLEARANCE_SCRAPER_URL ?? "http://staktrakr-byparr:8191";
const CF_CLEARANCE_ENABLED = process.env.CF_CLEARANCE_ENABLED ?? "1";
const CF_CLEARANCE_TIMEOUT_MS = process.env.CF_CLEARANCE_TIMEOUT_MS ?? "30000";

/**
 * Harvest a cf_clearance cookie (and pre-fetched HTML) from the Byparr sidecar.
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
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
    }

    const data = await response.json();
    if (data.status !== "ok" || !data.solution) {
      console.warn("[cf-clearance] unexpected response shape:", JSON.stringify(data).slice(0, 200));
      return null;
    }

    const cfCookie = data.solution.cookies?.find((c) => c.name === "cf_clearance");
    if (!cfCookie?.value) {
      // Cloudflare may not set a cookie (managed challenge / Turnstile), but
      // Byparr still fetched the page — return the HTML so the caller can
      // extract prices directly without needing a cookie+Playwright round-trip.
      if (data.solution.response) {
        console.log("[cf-clearance] no cookie, but have response HTML — returning for direct extraction");
      } else {
        console.warn("[cf-clearance] no cf_clearance cookie and no response HTML");
        return null;
      }
    }

    return {
      cfClearance: cfCookie?.value ?? null,
      userAgent: data.solution.userAgent,
      // HTML Byparr already fetched — lets caller skip a second browser request
      responseHtml: data.solution.response ?? null,
    };
  } catch (err) {
    console.warn("[cf-clearance] sidecar error: " + err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

#!/usr/bin/env node
/**
 * StakTrakr Retail Price Capture
 * ================================
 * Visits dealer product pages via Browserbase (cloud), self-hosted Browserless,
 * or local Chromium, takes a screenshot of each, and writes a manifest for
 * downstream extraction (Gemini vision, etc.).
 *
 * Parallel mode (Browserbase): one session per coin, all running
 * concurrently. ~67 pages (7 providers × 11 coins) completes in ~2 min
 * instead of ~8 minutes sequential.
 *
 * Usage:
 *   node capture.js                          # Browserbase cloud (parallel)
 *   BROWSER_MODE=local node capture.js       # Local Chromium (sequential)
 *   BROWSER_MODE=browserless node capture.js # Self-hosted Browserless (sequential)
 */

import { chromium } from "playwright-core";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { config } from "dotenv";
import { loadProviders } from "./provider-db.js";

config(); // load .env

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BROWSER_MODE = process.env.BROWSER_MODE || "browserbase";
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;
const BROWSERLESS_WS =
  process.env.BROWSERLESS_URL || "ws://localhost:3000/chromium/playwright?token=local_dev_token";
const DATA_DIR = resolve(process.env.DATA_DIR || "../../data");
const ARTIFACT_DIR =
  process.env.ARTIFACT_DIR ||
  join(tmpdir(), "retail-poller-screenshots", new Date().toISOString().slice(0, 10));

// Home tinyproxy (residential IP via Tailscale) — REQUIRED for Chromium.
// Chromium does NOT respect the Tailscale exit node routing; without an explicit
// proxy it exits via the Fly.io datacenter IP, which is blocked by ~90% of
// dealer sites. This mirrors the PROXY_SERVER config in supervisord.conf
// (Firecrawl playwright-service) and HOME_PROXY_URL in price-extract.js.
const HOME_PROXY_URL = process.env.HOME_PROXY_URL || null;

const COINS = (
  process.env.COINS ||
  "ase,age,ape,buffalo,maple-silver,maple-gold,britannia-silver,krugerrand-silver,krugerrand-gold,generic-silver-round,generic-silver-bar-10oz"
)
  .split(",")
  .map((s) => s.trim());
const PROVIDERS = (
  process.env.PROVIDERS ||
  "apmex,sdbullion,jmbullion,monumentmetals,herobullion,bullionexchanges,summitmetals"
)
  .split(",")
  .map((s) => s.trim());

// Per-page delays (ms) — polite pacing within each session.
// Reduced from 4s/1s (2026-03 perf tuning): screenshots don't need full price
// table rendering — just enough for the visible viewport to stabilize.
const PAGE_LOAD_WAIT = 3000; // wait after domcontentloaded for JS rendering
const INTER_PAGE_DELAY = 500; // pause between pages within a session

// Per-provider wait overrides (ms) — for JS-heavy SPAs that need more render time.
// Reduced proportionally from original values (2026-03 perf tuning).
const PROVIDER_PAGE_LOAD_WAIT = {
  jmbullion: 7000, // Next.js, pricing table populates ~5-7s
  monumentmetals: 5000, // React Native Web SPA, router mounts ~4-5s
  bullionexchanges: 6000, // React/Magento SPA, pricing grid ~5-6s
  herobullion: 4000, // React, renders ~3-4s
};

// Per-dealer popup dismissal config.
// Each entry is an array of dismissal attempts tried in order.
//
// Fields per entry:
//   selector  — CSS selector for the close/dismiss element
//   action    — "click" (default) or "evaluate" (run JS)
//   js        — JavaScript string to evaluate (only when action="evaluate")
//   wait      — ms to wait after action (default 500)
//   desc      — human-readable description for logging
const POPUP_CONFIG = {
  summitmetals: [
    {
      selector:
        'div[class*="popup"] button[class*="close"], div[class*="modal"] button[class*="close"]',
      desc: "loyalty benefit popup close button",
      wait: 800,
    },
    {
      selector: 'button[class*="dismiss"], button[class*="no-thanks"], a[class*="close-popup"]',
      desc: "loyalty popup dismiss link",
      wait: 800,
    },
    {
      // Fallback: click the overlay backdrop to dismiss
      action: "evaluate",
      js: `document.querySelector('div[class*="overlay"], div[class*="backdrop"]')?.click()`,
      desc: "click overlay backdrop",
      wait: 500,
    },
  ],

  monumentmetals: [
    {
      selector: 'button.close, button[class*="close-modal"], [data-dismiss="modal"]',
      desc: "site modal close button",
      wait: 600,
    },
    {
      action: "evaluate",
      js: `document.querySelector('.modal-backdrop, div[class*="overlay"]')?.click()`,
      desc: "click modal backdrop",
      wait: 500,
    },
  ],

  herobullion: [
    {
      // Click body to collapse any open dropdown menus
      action: "evaluate",
      js: `document.body.click()`,
      desc: "click body to close dropdowns",
      wait: 400,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function loadProvidersData() {
  let tursoClient = null;
  try {
    tursoClient = (await import("./sqld-client.js")).createSqldClient();
  } catch {}
  return loadProviders(tursoClient, DATA_DIR);
}

/**
 * Build target list grouped by coin.
 * Each coin gets its own session (4 providers × ~8s = ~35s, well under 5-min limit).
 * 11 coins fits under the 25-concurrent-browser account limit.
 *
 * Returns: Map<coinSlug, Array<{coin, metal, provider, url}>>
 */
function buildTargetsByCoin(providersJson) {
  const byCoin = new Map();
  for (const coinSlug of COINS) {
    const coin = providersJson.coins[coinSlug];
    if (!coin) {
      log(`WARN: coin "${coinSlug}" not found in providers.json, skipping`);
      continue;
    }
    const targets = [];
    for (const provider of coin.providers) {
      if (!PROVIDERS.includes(provider.id)) continue;
      if (!provider.enabled || !provider.url) continue;
      targets.push({
        coin: coinSlug,
        metal: coin.metal,
        provider: provider.id,
        url: provider.url,
      });
    }
    if (targets.length > 0) byCoin.set(coinSlug, targets);
  }
  return byCoin;
}

// ---------------------------------------------------------------------------
// Browserbase session management
// ---------------------------------------------------------------------------

async function createBrowserbaseSession() {
  const response = await fetch("https://www.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bb-api-key": BROWSERBASE_API_KEY,
    },
    body: JSON.stringify({ projectId: BROWSERBASE_PROJECT_ID }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Browserbase session creation failed (${response.status}): ${text.slice(0, 200)}`
    );
  }

  const session = await response.json();
  return session.id;
}

async function connectBrowserbaseSession(sessionId) {
  const wsUrl = `wss://connect.browserbase.com?apiKey=${BROWSERBASE_API_KEY}&sessionId=${sessionId}`;
  const browser = await chromium.connectOverCDP(wsUrl);
  const context =
    browser.contexts()[0] ||
    (await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }));
  const page = await context.newPage();
  return { browser, page };
}

async function connectBrowserlessSession() {
  const { chromium: coreChromium } = await import("playwright-core");
  // Browserless v2 uses Playwright wire protocol, not CDP
  // Use .connect() instead of .connectOverCDP()
  const browser = await coreChromium.connect(BROWSERLESS_WS);
  try {
    // Create a new context with explicit viewport and userAgent
    // Browserless allows full context control via Playwright wire protocol
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    return { browser, context };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Popup dismissal
// ---------------------------------------------------------------------------

/**
 * Dismiss popups/overlays before screenshot.
 * Tries dealer-specific selectors first, then generic fallbacks.
 * All actions are non-fatal — errors are logged but never thrown.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} providerId - dealer identifier (e.g. "summitmetals")
 */
async function dismissPopups(page, providerId) {
  const GENERIC_SELECTORS = [
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    ".modal-close",
    ".popup-close",
    ".close-button",
    '[data-dismiss="modal"]',
    '[data-testid="close"]',
    "button.close",
    ".klaviyo-close-form",
  ];

  try {
    // Step 1: Universal Escape key press
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Step 2: Dealer-specific selectors
    const dealerConfig = POPUP_CONFIG[providerId];
    if (dealerConfig) {
      for (const entry of dealerConfig) {
        try {
          const action = entry.action || "click";
          const wait = entry.wait || 500;

          if (action === "evaluate" && entry.js) {
            await page.evaluate(entry.js);
            log(`[${providerId}] popup: dismissed "${entry.desc}"`);
            await page.waitForTimeout(wait);
          } else if (entry.selector) {
            const btn = await page.$(entry.selector);
            if (btn) {
              await btn.click({ timeout: 3000 });
              log(`[${providerId}] popup: dismissed "${entry.desc}"`);
              await page.waitForTimeout(wait);
            }
          }
        } catch (e) {
          log(`[${providerId}] popup: "${entry.desc}" failed — ${e.message.slice(0, 60)}`);
        }
      }
    }

    // Step 3: Generic fallback selectors
    for (const sel of GENERIC_SELECTORS) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click({ timeout: 3000 });
          log(`[${providerId}] popup: dismissed generic "${sel}"`);
          await page.waitForTimeout(300);
          break;
        }
      } catch {
        /* non-fatal */
      }
    }
  } catch (e) {
    log(`[${providerId}] popup: dismissal error — ${e.message.slice(0, 80)}`);
  }
}

// ---------------------------------------------------------------------------
// Capture one coin's targets — direct first, proxy fallback (local mode)
// ---------------------------------------------------------------------------

/**
 * Try direct Chromium first; fall back to proxy page on 403 or timeout.
 * This avoids routing all traffic through the home proxy when most dealer
 * sites respond fine to a direct datacenter request.
 *
 * @param {string} coinSlug
 * @param {Array<{coin:string, metal:string, provider:string, url:string}>} targets
 * @param {string} outDir
 * @param {import('playwright').Page} directPage  - page with no proxy
 * @param {import('playwright').Page|null} proxyPage - page routed through HOME_PROXY_URL (may be null)
 * @returns {Promise<Array<object>>}
 */
async function captureCoinDirectFirst(coinSlug, targets, outDir, directPage, proxyPage) {
  const results = [];

  for (const target of targets) {
    const filename = `${target.coin}_${target.provider}.png`;
    const filepath = join(outDir, filename);

    log(`[${coinSlug}/${target.provider}] -> ${target.url}`);

    let activePage = null;
    let status = 0;
    let via = "direct";
    let lastError = null;

    // --- Attempt 1: direct (no proxy) ---
    try {
      const response = await directPage.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      status = response ? response.status() : 0;

      if (status === 403 && proxyPage) {
        // 403 — dealer is blocking datacenter IP, try proxy
        log(`[${coinSlug}/${target.provider}] direct got 403, falling back to proxy`);
        throw new Error("403-fallback");
      }

      activePage = directPage;
    } catch (directErr) {
      lastError = directErr;

      // --- Attempt 2: proxy fallback (if available) ---
      if (proxyPage) {
        log(`[${coinSlug}/${target.provider}] proxy-fallback: ${target.url}`);
        try {
          const proxyResponse = await proxyPage.goto(target.url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          status = proxyResponse ? proxyResponse.status() : 0;
          activePage = proxyPage;
          via = "proxy";
          lastError = null;
        } catch (proxyErr) {
          lastError = proxyErr;
        }
      }
    }

    // --- If neither attempt yielded a page, record failure ---
    if (!activePage || lastError) {
      const errMsg = lastError ? lastError.message.slice(0, 200) : "no page available";
      results.push({
        coin: target.coin,
        provider: target.provider,
        metal: target.metal,
        url: target.url,
        status,
        title: "",
        screenshot: null,
        ok: false,
        error: errMsg,
      });
      log(`[${coinSlug}/${target.provider}]   x ${errMsg.slice(0, 80)}`);

      if (target !== targets[targets.length - 1]) {
        await directPage.waitForTimeout(INTER_PAGE_DELAY);
      }
      continue;
    }

    // --- Successful navigation — screenshot the active page ---
    try {
      const providerWait = PROVIDER_PAGE_LOAD_WAIT[target.provider] ?? PAGE_LOAD_WAIT;
      await activePage.waitForTimeout(providerWait);

      await dismissPopups(activePage, target.provider);

      await activePage.screenshot({ path: filepath, fullPage: false });
      const title = await activePage.title();

      results.push({
        coin: target.coin,
        provider: target.provider,
        metal: target.metal,
        url: target.url,
        status,
        title,
        screenshot: filename,
        ok: status === 200 && !title.toLowerCase().includes("not found"),
      });

      log(
        `[${coinSlug}/${target.provider}]   ok ${status} (${via}) "${title.slice(0, 50)}" -> ${filename}`
      );
    } catch (err) {
      results.push({
        coin: target.coin,
        provider: target.provider,
        metal: target.metal,
        url: target.url,
        status,
        title: "",
        screenshot: null,
        ok: false,
        error: err.message.slice(0, 200),
      });
      log(`[${coinSlug}/${target.provider}]   x (${via}) ${err.message.slice(0, 80)}`);
    }

    if (target !== targets[targets.length - 1]) {
      await activePage.waitForTimeout(INTER_PAGE_DELAY);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Capture one coin's targets using a dedicated browser session (cloud mode)
// ---------------------------------------------------------------------------

async function captureCoin(coinSlug, targets, outDir) {
  const results = [];

  let browser, page;
  if (BROWSER_MODE === "local") {
    const { chromium: localChromium } = await import("playwright");
    const launchOpts = { headless: true };
    if (HOME_PROXY_URL) launchOpts.proxy = { server: HOME_PROXY_URL };
    browser = await localChromium.launch(launchOpts);
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    page = await ctx.newPage();
  } else if (BROWSER_MODE === "browserless") {
    log(`[${coinSlug}] Connecting to Browserless at ${BROWSERLESS_WS}...`);
    const { browser: blBrowser, context: blContext } = await connectBrowserlessSession();
    browser = blBrowser;
    page = await blContext.newPage();
  } else {
    log(`[${coinSlug}] Creating Browserbase session...`);
    const sessionId = await createBrowserbaseSession();
    log(`[${coinSlug}] Session: ${sessionId}`);
    ({ browser, page } = await connectBrowserbaseSession(sessionId));
  }

  for (const target of targets) {
    const filename = `${target.coin}_${target.provider}.png`;
    const filepath = join(outDir, filename);

    log(`[${coinSlug}/${target.provider}] → ${target.url}`);

    try {
      const response = await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      const status = response ? response.status() : 0;

      const providerWait = PROVIDER_PAGE_LOAD_WAIT[target.provider] ?? PAGE_LOAD_WAIT;
      await page.waitForTimeout(providerWait);

      // Dismiss modals/popups before screenshot so they don't obscure prices
      await dismissPopups(page, target.provider);

      await page.screenshot({ path: filepath, fullPage: false });
      const title = await page.title();

      results.push({
        coin: target.coin,
        provider: target.provider,
        metal: target.metal,
        url: target.url,
        status,
        title,
        screenshot: filename,
        ok: status === 200 && !title.toLowerCase().includes("not found"),
      });

      log(`[${coinSlug}/${target.provider}]   ✓ ${status} "${title.slice(0, 50)}" → ${filename}`);
    } catch (err) {
      results.push({
        coin: target.coin,
        provider: target.provider,
        metal: target.metal,
        url: target.url,
        status: 0,
        title: "",
        screenshot: null,
        ok: false,
        error: err.message.slice(0, 200),
      });
      log(`[${coinSlug}/${target.provider}]   ✗ ${err.message.slice(0, 80)}`);
    }

    if (targets.indexOf(target) < targets.length - 1) {
      await page.waitForTimeout(INTER_PAGE_DELAY);
    }
  }

  await browser.close();
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function captureAll() {
  if (
    BROWSER_MODE !== "local" &&
    BROWSER_MODE !== "browserless" &&
    (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID)
  ) {
    console.error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required for cloud mode.");
    process.exit(1);
  }

  const providersJson = await loadProvidersData();
  const byCoin = buildTargetsByCoin(providersJson);

  if (byCoin.size === 0) {
    console.error("No targets to capture. Check COINS/PROVIDERS env vars.");
    process.exit(1);
  }

  const totalTargets = [...byCoin.values()].reduce((n, arr) => n + arr.length, 0);
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  // Probe proxy health (non-blocking, non-fatal)
  let proxyHealthy = false;
  if (HOME_PROXY_URL) {
    try {
      await fetch(HOME_PROXY_URL, { signal: AbortSignal.timeout(5000) });
      proxyHealthy = true;
      log(`Proxy probe: OK (${HOME_PROXY_URL})`);
    } catch {
      log(`WARN: HOME_PROXY_URL unreachable — proxy fallback disabled this run`);
    }
  } else {
    log(`Proxy probe: skipped (HOME_PROXY_URL not set)`);
  }

  let allResults;
  if (BROWSER_MODE === "local") {
    // Local mode: direct-first with proxy fallback.
    // Launch two browsers: one direct (datacenter IP), one proxied (residential IP).
    // Most dealer sites respond fine to direct; only 403/timeout pages fall back to proxy.
    // Two Chromium instances ~ 400MB — acceptable on 1GB+ containers.
    log(
      `Capturing ${totalTargets} pages — sequential (local Chromium, direct-first${HOME_PROXY_URL ? " + proxy fallback" : ""})`
    );
    const { chromium: localChromium } = await import("playwright");
    const UA =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    // Direct browser (no proxy)
    const directBrowser = await localChromium.launch({ headless: true });
    const directCtx = await directBrowser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: UA,
    });
    const directPage = await directCtx.newPage();

    // Proxy browser (only if HOME_PROXY_URL is configured)
    let proxyBrowser = null;
    let proxyPage = null;
    if (HOME_PROXY_URL && proxyHealthy) {
      proxyBrowser = await localChromium.launch({
        headless: true,
        proxy: { server: HOME_PROXY_URL },
      });
      const proxyCtx = await proxyBrowser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: UA,
      });
      proxyPage = await proxyCtx.newPage();
    }

    allResults = [];
    for (const [coinSlug, targets] of byCoin.entries()) {
      const results = await captureCoinDirectFirst(
        coinSlug,
        targets,
        ARTIFACT_DIR,
        directPage,
        proxyPage
      );
      allResults.push(...results);
    }

    await directBrowser.close();
    if (proxyBrowser) await proxyBrowser.close();
  } else {
    // Cloud/browserless: parallel sessions (Browserbase handles concurrency).
    log(`Capturing ${totalTargets} pages — ${byCoin.size} parallel sessions (one per coin)`);
    const coinJobs = [...byCoin.entries()].map(([coinSlug, targets]) =>
      captureCoin(coinSlug, targets, ARTIFACT_DIR)
    );
    allResults = (await Promise.all(coinJobs)).flat();
  }

  // Write manifest
  const manifest = {
    captured_at: new Date().toISOString(),
    date: today(),
    coins: COINS,
    providers: PROVIDERS,
    results: allResults,
  };

  const manifestPath = join(ARTIFACT_DIR, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log(`Manifest written: ${manifestPath}`);

  const ok = allResults.filter((r) => r.ok).length;
  const fail = allResults.filter((r) => !r.ok).length;
  log(`Done: ${ok}/${totalTargets} captured, ${fail} failed`);

  return manifest;
}

captureAll().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

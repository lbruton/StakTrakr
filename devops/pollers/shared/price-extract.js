#!/usr/bin/env node
/**
 * StakTrakr Retail Price Extractor
 * ==================================
 * Reads providers.json, scrapes each dealer URL via Playwright direct first
 * (no proxy, 15s timeout), falling back to Firecrawl (with proxy via
 * playwright-service) for targets that fail. Extracts the lowest in-stock
 * price and records each result to sqld.
 *
 * Usage:
 *   FIRECRAWL_API_KEY=fc-... node price-extract.js
 *
 * Environment:
 *   FIRECRAWL_API_KEY   Required for cloud Firecrawl. Omit for self-hosted.
 *   FIRECRAWL_BASE_URL  Self-hosted Firecrawl endpoint (default: api.firecrawl.dev)
 *   HOME_PROXY_URL        Cox WiFi tinyproxy URL (e.g. http://100.112.198.50:8888)
 *   DATA_DIR              Path to repo data/ folder (default: ../../data)
 *   COINS               Comma-separated coin slugs to run (default: all)
 *   DRY_RUN             Set to "1" to skip writing files
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadProviders } from "./provider-db.js";
import { getCFClearanceCookie } from "./cf-clearance.js";
import { loadWebscaleCookie, looksLikeWebscaleChallenge } from "./webscale-cookies.js";
import { shouldBypassFirecrawlPreferredForPhase0 } from "./price-extract-vendor-goldback.js";
import {
  DEADLINE_EXCEEDED,
  closeBrowserSafely,
  listChildPids,
  resolveCloseTimeoutMs,
  resolveVendorBudgetMs,
  withDeadline,
} from "./playwright-budget.js";
import {
  FIRECRAWL_PREFERRED_PROVIDERS,
  FIRECRAWL_TABLE_PARSE_PROVIDERS,
  PLAYWRIGHT_ONLY_PROVIDERS,
  providerCfg,
  resolveProxy,
} from "./price-extract-provider-config.js";
import { scrapeVendor } from "./price-extract-vendors.js";
import {
  JSONLD_OOS_VALUES,
  JSONLD_ZERO_PRICE,
  detectStockStatus,
  extractJsonLdAvailability,
  extractJsonLdPrice,
  extractJsonLdScriptsFromHtml,
  extractMarkdownPrice,
  firecrawlMarkdownResult,
  firecrawlOutOfStockResult,
  htmlToPlainText,
  isStructuredPriceResult,
  looksLikeChallengePage,
  markdownFromScrapeResult,
  preprocessMarkdown,
} from "./price-extract-shared.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
// Self-hosted Firecrawl: set FIRECRAWL_BASE_URL=http://localhost:3002
// Cloud Firecrawl (default): leave unset or set to https://api.firecrawl.dev
const FIRECRAWL_BASE_URL = (process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev").replace(
  /\/$/,
  ""
);
// PLAYWRIGHT_LAUNCH: set to "1" to launch Chromium locally instead of connecting
// to a remote browserless. Useful on Fly.io where browsers are installed but no
// external browserless service is running.
const PLAYWRIGHT_LAUNCH = process.env.PLAYWRIGHT_LAUNCH === "1";
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, "../../data"));
const DRY_RUN = process.env.DRY_RUN === "1";
const COIN_FILTER = process.env.COINS ? process.env.COINS.split(",").map((s) => s.trim()) : null;
const CF_CLEARANCE_ENABLED_FLAG = process.env.CF_CLEARANCE_ENABLED !== "0";
let cfAttempts = 0;
let cfSuccess = 0;
let cfFailures = 0;
// Cox WiFi tinyproxy (port 8888) — residential proxy via Tailscale.
// Set as Fly.io secret: fly secrets set HOME_PROXY_URL=http://100.112.198.50:8888
const HOME_PROXY_URL = process.env.HOME_PROXY_URL || null;

// Sequential with per-request jitter (2-8s) — avoids rate-limit fingerprinting.
// Targets are shuffled so the same vendor is never hit consecutively;
// per-vendor effective gap ≈ (47/7 vendors) × avg_jitter ≈ ~30s — well within limits.
// Kept short so each full run completes in <10 min and fits inside the 15-min cron window.
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3_000;

let dbHelpersPromise = null;
function loadDbHelpers() {
  dbHelpersPromise ??= import("./db.js");
  return dbHelpersPromise;
}

// Jitter between requests — randomised anti-pattern fingerprinting.
// Fly.io (datacenter IP) uses longer delays to avoid rate limits.
const POLLER_ID = process.env.POLLER_ID || "unknown";
function jitter() {
  const base = POLLER_ID === "home" ? 500 : 2_000;
  const range = POLLER_ID === "home" ? 1_500 : 6_000;
  return new Promise((r) => setTimeout(r, base + Math.random() * range));
}

// Fisher-Yates shuffle (in-place)
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function warn(msg) {
  console.warn(`[${new Date().toISOString().slice(11, 19)}] WARN: ${msg}`);
}

/** Wrapper around writeSnapshot that catches DB errors so a single failed
 *  write doesn't crash the entire run. Returns true on success. */
let _dbWriteFailures = 0;
async function safeWriteSnapshot(db, row, writeSnapshotFn) {
  try {
    await writeSnapshotFn(db, row);
    return true;
  } catch (err) {
    _dbWriteFailures++;
    warn(
      `DB write failed for ${row.coinSlug}/${row.vendor} (non-fatal): ${err.message.slice(0, 100)}`
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Firecrawl API
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Port of the Fly.io-proxied playwright-service (for BEx Cloudflare bypass)
const FLY_PW_SERVICE_PORT = process.env.FLY_PW_SERVICE_PORT || "3004";
// Scrape via proxied playwright-service (port 3004) — bypasses Firecrawl entirely.
// Returns plain text (like Phase 0 innerText), not markdown.
// Used for vendors behind Cloudflare that need the Fly.io IP.
async function scrapeViaProxy(url, waitFor = 15000, timeout = 40000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(`http://localhost:${FLY_PW_SERVICE_PORT}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, wait_after_load: waitFor, timeout }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`playwright-service-fly HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.pageStatusCode && json.pageStatusCode >= 400) {
      throw new Error(`upstream ${json.pageStatusCode}: ${json.pageError || "error"}`);
    }
    return htmlToPlainText(json.content || "");
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeViaCFClearance(url, providerId, coin) {
  log(`[cf-clearance] attempt: ${providerId} ${url}`);
  let cfData = await getCFClearanceCookie(url);
  if (!cfData) {
    warn(`[cf-clearance] sidecar unavailable for ${providerId}`);
    return null;
  }

  if (cfData.responseHtml && looksLikeChallengePage(cfData.responseHtml)) {
    warn(
      `[cf-clearance] challenge-looking HTML from Byparr for ${providerId} (len=${cfData.responseHtml.length}) — retrying once`
    );
    const retry = await getCFClearanceCookie(url);
    if (retry && retry.responseHtml && !looksLikeChallengePage(retry.responseHtml)) {
      // Merge: take retry's clean HTML but keep whichever cookie/UA is set.
      // Byparr often returns HTML without a cookie — losing a valid cookie
      // from the first attempt would silently break the Playwright fallback.
      cfData = {
        cfClearance: retry.cfClearance ?? cfData.cfClearance,
        userAgent: retry.userAgent ?? cfData.userAgent,
        responseHtml: retry.responseHtml,
      };
    } else {
      // Both attempts returned challenge HTML (or retry failed). Don't try to
      // extract prices from a challenge page — drop the HTML so we skip to the
      // Playwright fallback when a cookie is available.
      cfData = { ...cfData, responseHtml: null };
    }
  }

  // Byparr already fetched the page. Check stock status from both JSON-LD
  // availability and page text, then try JSON-LD price (authoritative).
  // For SPAs where both fail, fall through to Playwright with the cookie.
  if (cfData.responseHtml) {
    const jsonLdScripts = extractJsonLdScriptsFromHtml(cfData.responseHtml);

    // JSON-LD availability — BullionExchanges keeps JSON-LD price populated on
    // OOS pages but sets availability=OutOfStock (STRK-30).
    const availability = extractJsonLdAvailability(jsonLdScripts);
    const jsonLdOos = !!(availability && JSONLD_OOS_VALUES.has(availability));
    if (jsonLdOos) {
      log(`[cf-clearance] ${providerId}: JSON-LD availability=${availability} -> OOS`);
    }

    // Text-based OOS detection — catches visible "Out Of Stock" text even when
    // JSON-LD availability is stale/missing.
    const rawText = htmlToPlainText(cfData.responseHtml);
    const cleaned = preprocessMarkdown(rawText, providerId);
    const textStock = detectStockStatus(cleaned, coin.weight_oz || 1, providerId);
    const isInStock = !jsonLdOos && textStock.inStock;

    const jsonLdPrice = extractJsonLdPrice(
      jsonLdScripts,
      coin.metal,
      coin.weight_oz || 1,
      providerId
    );
    if (jsonLdPrice === JSONLD_ZERO_PRICE) {
      log(`[cf-clearance] ${providerId}: JSON-LD price=0 in Byparr HTML -> OOS`);
      return { price: null, inStock: false, source: "cf-clearance:jsonLd" };
    }
    if (jsonLdPrice !== null) {
      log(
        `[cf-clearance] success (html jsonLd): ${providerId} price=${jsonLdPrice} inStock=${isInStock}`
      );
      return { price: jsonLdPrice, inStock: isInStock, source: "cf-clearance:jsonLd" };
    }

    const price = extractMarkdownPrice(cleaned, coin.metal, coin.weight_oz || 1, providerId);
    if (price !== null) {
      log(`[cf-clearance] success (html): ${providerId} price=${price.price}`);
      return {
        price: price.price,
        inStock: isInStock,
        source: `cf-clearance:${price.matchedBy}`,
      };
    }
    if (!isInStock) {
      log(`[cf-clearance] ${providerId}: OOS detected but no price extractable`);
      return { price: null, inStock: false, source: "cf-clearance:oos" };
    }
    warn(
      `[cf-clearance] no price from Byparr HTML for ${providerId} (len=${cfData.responseHtml.length}, jsonLd=${jsonLdScripts.length}) -- falling through to Playwright`
    );
  }

  if (!cfData.cfClearance) {
    warn(
      `[cf-clearance] ${providerId}: Byparr had no cookie and HTML yielded no price -- cannot fall back to Playwright`
    );
    return null;
  }
  let browser;
  try {
    const cfg = providerCfg(providerId);
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      userAgent: cfData.userAgent,
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    const urlObj = new URL(url);
    await context.addCookies([
      {
        name: "cf_clearance",
        value: cfData.cfClearance,
        domain: urlObj.hostname,
        path: "/",
        httpOnly: false,
        secure: true,
      },
    ]);
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "font", "stylesheet", "media"].includes(type)) route.abort();
      else route.continue();
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: cfg.timeout || 40000 });
    if (cfg.waitFor > 0) await page.waitForTimeout(cfg.waitFor);
    // Capture JSON-LD BEFORE removing nav elements — some vendors embed
    // <script type="application/ld+json"> inside <header>/<footer>; removing first
    // would make querySelectorAll return empty. Strip nav/header/footer after capturing
    // to prevent spot tickers from polluting innerText (Firecrawl onlyMainContent equivalent).
    const [text, jsonLdScripts] = await page.evaluate(() => {
      const scripts = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
        (s) => s.textContent
      );
      document
        .querySelectorAll("nav, header, footer, [role='navigation'], [role='banner']")
        .forEach((el) => el.remove());
      return [document.body.innerText, scripts];
    });
    await browser.close();
    browser = null;
    const cleaned = preprocessMarkdown(text, providerId);
    const inStock = detectStockStatus(cleaned, coin.weight_oz || 1, providerId);
    // JSON-LD is authoritative — avoids related-product / spot ticker false positives.
    const jsonLdPrice = extractJsonLdPrice(
      jsonLdScripts,
      coin.metal,
      coin.weight_oz || 1,
      providerId
    );
    if (jsonLdPrice === JSONLD_ZERO_PRICE) {
      log(`[cf-clearance] ${providerId}: JSON-LD price=0 → OOS, skipping HTML extraction`);
      return { price: null, inStock: false, source: "cf-clearance" };
    }
    if (jsonLdPrice !== null) {
      log(`[cf-clearance] success via jsonLd: ${providerId} price=${jsonLdPrice}`);
      return { price: jsonLdPrice, inStock: inStock.inStock, source: "cf-clearance:jsonLd" };
    }
    const price = extractMarkdownPrice(cleaned, coin.metal, coin.weight_oz || 1, providerId);
    if (price !== null) {
      log(`[cf-clearance] success (playwright): ${providerId} price=${price.price}`);
      return {
        price: price.price,
        inStock: inStock.inStock,
        source: `cf-clearance:${price.matchedBy}`,
      };
    }
    warn(`[cf-clearance] no price extracted for ${providerId}`);
    return null;
  } catch (err) {
    warn(`[cf-clearance] failure: ${providerId} error=${err.message}`);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function scrapeUrl(url, providerId = "", attempt = 1, coin = null, providerConfig = null) {
  const controller = new AbortController();
  const cfg = providerConfig || providerCfg(providerId);
  const scrapeTimeout = cfg.timeout;
  const timer = setTimeout(() => controller.abort(), scrapeTimeout);

  const formats = cfg.requestHtml ? ["markdown", "html"] : ["markdown"];
  const body = {
    url,
    formats,
    // JM Bullion's React pages sometimes return empty markdown with onlyMainContent.
    // Disable it for JM — our MARKDOWN_CUTOFF_PATTERNS handle noise removal instead.
    onlyMainContent: cfg.onlyMainContent,
  };
  // JS-heavy SPAs need time to mount and render prices; 8s covers all slow providers.
  // (Bumped from 6s after jmbullion/bullionexchanges were removed from PLAYWRIGHT_ONLY;
  // their React SPAs need the extra 2s to fully render pricing tables.)
  const cfgWaitFor = cfg.waitFor;
  if (cfgWaitFor > 0) body.waitFor = cfgWaitFor;

  try {
    const response = await fetch(`${FIRECRAWL_BASE_URL}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(FIRECRAWL_API_KEY ? { Authorization: `Bearer ${FIRECRAWL_API_KEY}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // 403 = bot detection / IP block. Retrying Firecrawl (same IP) won't help;
      // skip retries — terminal failure for this target.
      if (response.status === 403) {
        if (cfg.cf_clearance_fallback && CF_CLEARANCE_ENABLED_FLAG) {
          cfAttempts++;
          const phase2 = await scrapeViaCFClearance(url, providerId, coin);
          if (phase2 !== null) {
            cfSuccess++;
            return { type: "price-result", markdown: "", ...phase2 };
          }
          cfFailures++;
        }
        throw Object.assign(new Error(`HTTP 403 (blocked): ${text.slice(0, 200)}`), {
          skipRetry: true,
        });
      }
      // 408 = Firecrawl scrape timeout. For jmbullion, retrying won't help —
      // the page either renders in time or it doesn't. Skip retries to save ~40s.
      if (response.status === 408 && !cfg.retryOn408) {
        throw Object.assign(
          new Error(
            `HTTP 408 (scrape timeout, jmb/monument retry disabled): ${text.slice(0, 200)}`
          ),
          { skipRetry: true }
        );
      }
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const json = await response.json();
    const markdown = json?.data?.markdown ?? null;

    // STAK-566: When HTML is requested (e.g. herobullion), check JSON-LD
    // `availability` before returning markdown. Hero pages keep the price
    // visible on sold-out products, so the markdown-only path always extracts
    // a valid price and reports inStock=true. Mirrors the cf-clearance JSON-LD
    // OOS short-circuit pattern in scrapeViaCFClearance.
    if (cfg.requestHtml) {
      const html = json?.data?.html ?? null;
      if (html) {
        const jsonLdScripts = extractJsonLdScriptsFromHtml(html);
        const availability = extractJsonLdAvailability(jsonLdScripts);
        if (availability && JSONLD_OOS_VALUES.has(availability)) {
          log(`[firecrawl] ${providerId}: JSON-LD availability=${availability} -> OOS`);
          return firecrawlOutOfStockResult();
        }
      }
    }

    return firecrawlMarkdownResult(markdown);
  } catch (err) {
    // Abort/timeout = the request was killed by our AbortController.
    // Retrying the same Firecrawl call won't help; skip retries.
    if (err.name === "AbortError" || (err.message && err.message.includes("aborted"))) {
      err.skipRetry = true;
    }
    if (!err.skipRetry && attempt < RETRY_ATTEMPTS) {
      warn(`Retry ${attempt}/${RETRY_ATTEMPTS} for ${url}: ${err.message}`);
      await sleep(RETRY_DELAY_MS * attempt);
      return scrapeUrl(url, providerId, attempt + 1, coin, cfg);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Playwright direct — fast first-pass, no proxy, 15s timeout
// ---------------------------------------------------------------------------

/**
 * Lightweight Playwright scrape: direct connection (no proxy), 15s timeout,
 * no retries. Designed as a fast first-pass that succeeds for ~65/88 targets
 * in under 5s. Returns null immediately on any failure so Firecrawl can
 * take over as fallback.
 *
 * @param {string} url
 * @param {string} providerId
 * @param {Object} coin  Coin metadata (metal, weight_oz)
 * @returns {Promise<{price: number, inStock: boolean, source: string}|null>}
 */
async function scrapeWithPlaywrightDirect(url, providerId, coin) {
  if (!PLAYWRIGHT_LAUNCH) return null;

  const DIRECT_TIMEOUT_MS = 15_000;
  const { chromium } = await import("playwright-core");
  let browser;

  // Playwright's `Browser` (unlike `BrowserServer`) exposes no handle on the
  // Chromium it spawned, so record the pids that appear across launch. If
  // teardown later wedges, these are the only way to reap the browser — once
  // this Node process exits they are reparented to init and the run-lock
  // watchdog's tree walk can no longer see them (STRK-255).
  const pidsBeforeLaunch = new Set(listChildPids());
  let browserPids = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    browserPids = listChildPids().filter((pid) => !pidsBeforeLaunch.has(pid));

    // Webscale-protected vendors (jmbullion, providentmetals): if an operator
    // has stashed a solved wspc cookie for this host, inject it with the UA it
    // was solved under. Webscale binds clearance to IP + Chrome-class UA + wspc,
    // and the poller shares the operator's public IP (STRK-230). No cookie → we
    // proceed bare and the challenge detector below flags the need to re-solve.
    const urlObj = new URL(url);
    const webscaleCookie = loadWebscaleCookie(urlObj.hostname);
    const DEFAULT_UA =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    const context = await browser.newContext({
      userAgent: webscaleCookie?.userAgent || DEFAULT_UA,
      viewport: { width: 1920, height: 1080 },
    });
    if (webscaleCookie) {
      await context.addCookies([
        {
          name: "wspc",
          value: webscaleCookie.wspc,
          domain: urlObj.hostname,
          path: "/",
          httpOnly: false,
          secure: true,
        },
      ]);
      log(
        `  (playwright-direct) injected Webscale wspc for ${providerId} (UA ${webscaleCookie.userAgent ? "matched" : "default"}, updated ${webscaleCookie.updatedAt || "?"})`
      );
    }
    const page = await context.newPage();

    // Block non-essential resource types to reduce bandwidth ~60-80%
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "font", "stylesheet", "media"].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    const phase0WaitUntil = providerCfg(providerId).waitUntil;
    const response = await page.goto(url, {
      waitUntil: phase0WaitUntil,
      timeout: DIRECT_TIMEOUT_MS,
    });

    // 403 = bot detection — bail immediately, let Firecrawl handle it
    if (response && response.status() === 403) {
      log(`  (playwright-direct) 403 on ${providerId} — skipping to Firecrawl`);
      return null;
    }

    // Per-provider extra wait for JS rendering (Phase A: herobullion 8s->2s)
    // Phase 0 wait handled by providerCfg().waitAfter
    const phase0Wait = providerCfg(providerId).waitAfter;
    if (phase0Wait > 0) {
      await page.waitForTimeout(phase0Wait);
    }

    // Capture JSON-LD BEFORE removing nav elements (same as scrapeViaCFClearance Phase 2).
    // Some vendors embed <script type="application/ld+json"> inside <header>/<footer>;
    // removing those elements first would return empty scripts. After capturing, strip
    // nav/header/footer to prevent spot tickers from polluting innerText and causing
    // firstInRangePriceProse() to match the spot price instead of the product price.
    const [text, jsonLdScripts, pageHtmlHead] = await page.evaluate(() => {
      const scripts = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
        (s) => s.textContent
      );
      // Capture a small HTML slice BEFORE stripping nav: the Webscale challenge
      // markers live in <head>/<script> (errorpage.css, i-am-a-human), which
      // innerText drops. The interstitial is tiny so the head + visible text fit.
      const htmlHead = document.documentElement.outerHTML.slice(0, 8192);
      document
        .querySelectorAll("nav, header, footer, [role='navigation'], [role='banner']")
        .forEach((el) => el.remove());
      return [document.body.innerText, scripts, htmlHead];
    });
    // Stale/missing wspc → Webscale serves a reCAPTCHA interstitial instead of
    // the product. Surface it loudly so the operator knows to re-solve, and bail
    // so Firecrawl/FBP can take over rather than extracting garbage (STRK-230).
    if (looksLikeWebscaleChallenge(pageHtmlHead) || looksLikeWebscaleChallenge(text)) {
      warn(
        `  (playwright-direct) ⚠️ WEBSCALE CHALLENGE for ${providerId} (${urlObj.hostname}) — wspc cookie missing/stale, RE-SOLVE NEEDED: run webscale-solve.mjs (or webscale-cookies.js set ${urlObj.hostname} <wspc> "<UA>")`
      );
      return null;
    }
    const cleaned = preprocessMarkdown(text, providerId);
    const stock = detectStockStatus(cleaned, coin.weight_oz || 1, providerId);

    // JSON-LD is authoritative — check before regex fallbacks to avoid
    // grabbing spot ticker deltas or related-product prices from innerText.
    const jsonLdPrice = extractJsonLdPrice(
      jsonLdScripts,
      coin.metal,
      coin.weight_oz || 1,
      providerId
    );
    if (jsonLdPrice === JSONLD_ZERO_PRICE) {
      log(`  ${providerId}: JSON-LD price=0 → OOS, skipping HTML extraction`);
      return { price: null, inStock: false, source: "playwright-direct" };
    }
    if (jsonLdPrice !== null) {
      log(`  extractPrice ${providerId}: matched=jsonLd price=$${jsonLdPrice.toFixed(2)}`);
      return { price: jsonLdPrice, inStock: stock.inStock, source: "playwright-direct:jsonLd" };
    }

    const extracted = extractMarkdownPrice(cleaned, coin.metal, coin.weight_oz || 1, providerId);
    const price = extracted ? extracted.price : null;
    if (extracted)
      log(
        `  extractPrice ${providerId}: matched=${extracted.matchedBy} price=$${extracted.price.toFixed(2)}`
      );

    if (price !== null) {
      return { price, inStock: stock.inStock, source: `playwright-direct:${extracted.matchedBy}` };
    }

    // OOS with no price — still useful stock status info, but let Firecrawl try for a price
    if (!stock.inStock) {
      log(`  (playwright-direct) ${providerId}: OOS detected but no price — trying Firecrawl`);
      return null;
    }

    // Page loaded but no price extracted — Firecrawl may parse differently
    return null;
  } catch (err) {
    log(`  (playwright-direct) ${providerId} failed: ${err.message.slice(0, 100)} — falling back`);
    return null;
  } finally {
    // `browser.close()` has no timeout of its own. On 2026-07-19 it hung here
    // *after* the navigation error had already been caught and logged, wedging
    // the run and freezing retail data for ~3.5h (STRK-255). Teardown must
    // always return, escalating to a process kill if the graceful close stalls.
    await closeBrowserSafely(browser, {
      timeoutMs: resolveCloseTimeoutMs(),
      log,
      fallbackPids: browserPids,
    });
  }
}

async function scrapeGenericTarget(context) {
  const { coinSlug, coin, provider } = context;
  const urls = context.urls ?? provider.urls ?? (provider.url ? [provider.url] : []);
  let price = null;
  let source = "firecrawl";
  let inStock = true;
  let finalUrl = urls[0];
  const retriedUrls = new Set();
  const cfg = providerCfg(provider.id, context.vendorModule?.config ?? context.config);

  const buildResult = () => {
    const ok = price !== null || !inStock;
    return {
      coinSlug,
      coin,
      providerId: provider.id,
      url: finalUrl,
      price,
      source,
      inStock,
      ok,
      error: ok ? null : "price_not_found",
    };
  };

  // ── Phase CF-First: Byparr/CF-clearance first (for cf-clearance-first vendors) ─
  // For CF-gated vendors (BEx), skip the 70s Firecrawl timeout and solve via Byparr
  // first. If Byparr fails, fall through to Phase 0/1 as safety net.
  if (cfg.phase === "cf-clearance-first" && CF_CLEARANCE_ENABLED_FLAG) {
    log(`  [cf-first] ${provider.id}: trying Byparr first`);
    cfAttempts++;
    const cfResult = await scrapeViaCFClearance(urls[0], provider.id, coin);
    if (cfResult != null && cfResult.price != null) {
      cfSuccess++;
      price = cfResult.price;
      source = cfResult.source;
      inStock = cfResult.inStock;
      finalUrl = urls[0];
      log(
        `  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (cf-first${!inStock ? ", OOS" : ""})`
      );
      return buildResult();
    }
    // Byparr returned null or no price — OOS with no price is still useful.
    if (cfResult != null && cfResult.price == null && !cfResult.inStock) {
      cfSuccess++;
      source = cfResult.source;
      inStock = false;
      finalUrl = urls[0];
      log(`  ✓ ${coinSlug}/${provider.id}: OOS detected (cf-first, no price)`);
      return buildResult();
    }
    cfFailures++;
    log(`  ↻ ${coinSlug}/${provider.id}: cf-first failed — falling through to Phase 0/1`);
  }

  // ── Phase 0: Try Playwright direct (no proxy, 15s timeout) ──────────────
  // Fast first-pass — succeeds for ~65/88 targets in <5s. If it gets a price,
  // skip Firecrawl entirely. Skip for PLAYWRIGHT_ONLY_PROVIDERS (they need
  // Firecrawl's stealth patches) and FIRECRAWL_PREFERRED_PROVIDERS (they need
  // Firecrawl's markdown pipe-table conversion for correct extraction).
  // Exception: goldback slugs are individual product detail pages with a single
  // prominently-displayed price — not HTML pricing tables — so Phase 0 Playwright
  // extracts prices correctly for table-parse vendors (monumentmetals).
  // Bot-detection vendors (jmbullion, bullionexchanges) are NOT bypassed: they
  // still need Firecrawl stealth even on goldback detail pages (API-14).
  const fcPreferredForTarget =
    (cfg.phase === "firecrawl" || FIRECRAWL_PREFERRED_PROVIDERS.has(provider.id)) &&
    !shouldBypassFirecrawlPreferredForPhase0({
      coinSlug,
      providerId: provider.id,
      tableParseProviderIds: FIRECRAWL_TABLE_PARSE_PROVIDERS,
    });
  if (!PLAYWRIGHT_ONLY_PROVIDERS.has(provider.id) && !fcPreferredForTarget && PLAYWRIGHT_LAUNCH) {
    // Total-attempt ceiling on top of the per-call navigation timeout, so one
    // hostile vendor cannot hang the whole run in an unbounded launch/evaluate/
    // teardown step. A blown budget is treated as "no result" and falls through
    // to Firecrawl rather than aborting the poll (STRK-255).
    const budgetMs = resolveVendorBudgetMs();
    const budgeted = await withDeadline(
      scrapeWithPlaywrightDirect(urls[0], provider.id, coin),
      budgetMs
    );
    if (budgeted === DEADLINE_EXCEEDED) {
      warn(
        `  (playwright-direct) ${provider.id} exceeded ${budgetMs}ms vendor budget — abandoning and falling back`
      );
    }
    const directResult = budgeted === DEADLINE_EXCEEDED ? null : budgeted;
    if (directResult !== null) {
      price = directResult.price;
      source = directResult.source;
      inStock = directResult.inStock;
      finalUrl = urls[0];
      if (price !== null) {
        log(
          `  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (playwright-direct${!inStock ? ", OOS" : ""})`
        );
      } else {
        log(`  ✓ ${coinSlug}/${provider.id}: OOS detected (playwright-direct, no price)`);
      }
      return buildResult();
    }
  }

  // ── Phase 1: Try all URLs via Firecrawl ──────────────────────────────────
  // Skip Phase 1 for providers where Firecrawl is structurally unreliable
  // (bot detection or waitFor-not-supported JS rendering). price/inStock stay
  // at their defaults (null / true) so the failure path fires below.
  if (!PLAYWRIGHT_ONLY_PROVIDERS.has(provider.id)) {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      if (i > 0) log(`  → ${coinSlug}/${provider.id}: fallback URL [${i}]: ${url}`);

      try {
        // Proxy-first path: if this provider routes through an alternate IP,
        // try the proxied playwright-service first (e.g., Fly.io IP for BEx).
        let markdown;
        const proxyTarget = resolveProxy(provider.id);
        if (proxyTarget) {
          try {
            const proxyText = await scrapeViaProxy(url, cfg.waitFor, cfg.timeout);
            // scrapeViaProxy returns plain text (like Phase 0), not markdown.
            // Use it directly for extraction — preprocessMarkdown handles both.
            const proxyCleaned = preprocessMarkdown(proxyText, provider.id);
            const proxyStock = detectStockStatus(proxyCleaned, coin.weight_oz || 1, provider.id);
            const proxyExtracted = extractMarkdownPrice(
              proxyCleaned,
              coin.metal,
              coin.weight_oz || 1,
              provider.id
            );
            if (proxyExtracted) {
              log(
                `  extractPrice ${provider.id}: matched=${proxyExtracted.matchedBy} price=$${proxyExtracted.price.toFixed(2)} (fly-proxy)`
              );
              price = proxyExtracted.price;
              source = `fly-proxy:${proxyExtracted.matchedBy}`;
              inStock = proxyStock.inStock;
              finalUrl = url;
              log(
                `  \u2713 ${coinSlug}/${provider.id}: $${price.toFixed(2)} (fly-proxy)${!inStock ? " OOS" : ""}`
              );
              break;
            }
            log(
              `  \u21bb ${coinSlug}/${provider.id}: fly-proxy returned no price, falling back to firecrawl`
            );
          } catch (proxyErr) {
            warn(
              `  \u2717 ${provider.id} fly-proxy error: ${proxyErr.message.slice(0, 80)}, falling back`
            );
          }
        }
        const scrapeResult = await scrapeUrl(url, provider.id, 1, coin, cfg);
        // Structured scrape results can carry JSON-LD OOS without markdown parsing.
        if (isStructuredPriceResult(scrapeResult)) {
          price = scrapeResult.price;
          source = scrapeResult.source;
          inStock = scrapeResult.inStock;
          finalUrl = url;
          // price may be null when cf-clearance detected OOS via JSON-LD
          // (zero-price sentinel) — guard before toFixed.
          if (price != null) {
            log(`  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (${source})`);
          } else {
            log(`  ✓ ${coinSlug}/${provider.id}: OOS, no price (${source})`);
          }
          break;
        }
        markdown = markdownFromScrapeResult(scrapeResult);
        const cleaned = preprocessMarkdown(markdown, provider.id);
        const stock = detectStockStatus(cleaned, coin.weight_oz || 1, provider.id);

        if (!stock.inStock) {
          log(
            `  ⚠ ${provider.id} [url${i}]: ${stock.reason} — ${stock.detectedText || "detected"}`
          );
          // Still attempt price extraction — OOS pages often show advertised price
          const oosExtracted = extractMarkdownPrice(
            cleaned,
            coin.metal,
            coin.weight_oz || 1,
            provider.id
          );
          const oosPrice = oosExtracted ? oosExtracted.price : null;
          if (oosExtracted)
            log(
              `  extractPrice ${provider.id}: matched=${oosExtracted.matchedBy} price=$${oosExtracted.price.toFixed(2)} (OOS)`
            );
          if (oosPrice !== null) {
            price = oosPrice;
            source = `firecrawl:${oosExtracted.matchedBy}`;
            finalUrl = url;
            log(`  ✓ ${coinSlug}/${provider.id}: $${oosPrice.toFixed(2)} (firecrawl, OOS)`);
          }
          if (i < urls.length - 1 && oosPrice === null) {
            await jitter();
            continue;
          }
          // Last URL or got a price — exit loop with inStock=false
          inStock = false;
          if (!finalUrl || finalUrl !== url) finalUrl = url;
          break;
        }

        const extracted = extractMarkdownPrice(
          cleaned,
          coin.metal,
          coin.weight_oz || 1,
          provider.id
        );
        const p = extracted ? extracted.price : null;
        if (extracted)
          log(
            `  extractPrice ${provider.id}: matched=${extracted.matchedBy} price=$${extracted.price.toFixed(2)}`
          );
        if (p !== null) {
          price = p;
          source = `firecrawl:${extracted.matchedBy}`;
          finalUrl = url;
          log(
            `  ✓ ${coinSlug}/${provider.id}: $${p.toFixed(2)} (firecrawl)${urls.length > 1 ? ` [url${i}]` : ""}`
          );
          break;
        }

        // Parse failure on this URL — retry once with longer wait for FIRECRAWL_PREFERRED
        // providers (jmbullion, bullionexchanges) where proxy latency can cause under-render.
        if (fcPreferredForTarget && !retriedUrls.has(url)) {
          retriedUrls.add(url);
          log(`  ↻ ${coinSlug}/${provider.id} [url${i}]: retrying with extended waitFor...`);
          await jitter();
          try {
            const retryRaw = await scrapeUrl(url, provider.id, 1, coin, cfg);
            // Structured scrape results can carry JSON-LD OOS without markdown parsing.
            if (isStructuredPriceResult(retryRaw)) {
              price = retryRaw.price;
              source = retryRaw.source;
              inStock = retryRaw.inStock;
              finalUrl = url;
              if (price != null) {
                log(`  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (${source})`);
              } else {
                log(`  ✓ ${coinSlug}/${provider.id}: OOS, no price (${source})`);
              }
              break;
            }
            const retryMd = markdownFromScrapeResult(retryRaw);
            const retryCleaned = preprocessMarkdown(retryMd, provider.id);
            const retryStock = detectStockStatus(retryCleaned, coin.weight_oz || 1, provider.id);
            const retryExtracted = extractMarkdownPrice(
              retryCleaned,
              coin.metal,
              coin.weight_oz || 1,
              provider.id
            );
            const retryPrice = retryExtracted ? retryExtracted.price : null;
            if (retryExtracted)
              log(
                `  extractPrice ${provider.id}: matched=${retryExtracted.matchedBy} price=$${retryExtracted.price.toFixed(2)} (retry)`
              );
            if (retryPrice !== null) {
              price = retryPrice;
              source = `firecrawl-retry:${retryExtracted.matchedBy}`;
              inStock = retryStock.inStock;
              finalUrl = url;
              log(
                `  ✓ ${coinSlug}/${provider.id}: $${retryPrice.toFixed(2)} (firecrawl-retry)${!inStock ? " OOS" : ""}`
              );
              break;
            }
          } catch (retryErr) {
            warn(`  ✗ ${provider.id} [url${i}] retry error: ${retryErr.message.slice(0, 100)}`);
          }
        }

        warn(`  ? ${coinSlug}/${provider.id} [url${i}]: page loaded, no price — trying next URL`);
        if (i < urls.length - 1) {
          await jitter();
          continue;
        }

        // Last URL, Firecrawl parse failure — no more fallbacks
        finalUrl = url;
      } catch (err) {
        warn(`  ✗ ${provider.id} [url${i}] firecrawl error: ${err.message.slice(0, 100)}`);
        if (i < urls.length - 1) {
          await jitter();
          continue;
        }
        // Last URL threw — no more fallbacks
        finalUrl = url;
      }
    }
  }

  // ── Phase 2 fallback: CF-clearance for invisible Cloudflare challenges ──────
  // Cloudflare's JS challenge returns 200 (not 403), so the in-scrapeUrl 403
  // trigger never fires. If Phase 0+1 both returned no price for a
  // cf_clearance_fallback vendor, attempt Byparr now as a last resort.
  // Skip for cf-clearance-first vendors — they already tried Byparr at the top.
  if (price === null && inStock && cfg.phase !== "cf-clearance-first") {
    if (cfg.cf_clearance_fallback && CF_CLEARANCE_ENABLED_FLAG) {
      log(`  [cf-clearance] ${provider.id}: no price from Phase 0/1 — trying Byparr bypass`);
      cfAttempts++;
      try {
        const phase2 = await scrapeViaCFClearance(urls[0], provider.id, coin);
        if (phase2 !== null) {
          price = phase2.price;
          source = phase2.source;
          inStock = phase2.inStock;
          finalUrl = urls[0];
          cfSuccess++;
          if (price !== null) {
            log(`  ✓ ${coinSlug}/${provider.id}: $${price.toFixed(2)} (${source})`);
          } else {
            log(`  ✓ ${coinSlug}/${provider.id}: OOS, no price (${source})`);
          }
        } else {
          cfFailures++;
        }
      } catch (cfErr) {
        cfFailures++;
        warn(`  ✗ ${provider.id} cf-clearance error: ${cfErr.message.slice(0, 100)}`);
      }
    }
  }

  // Log terminal state if not already logged.
  if (price === null && inStock) {
    warn(`  ? ${coinSlug}/${provider.id}: all URLs exhausted, no price found`);
  }

  return buildResult();
}

function providerUrls(provider, url, urls) {
  if (Array.isArray(urls) && urls.length > 0) return urls;
  if (url) return [url];
  if (Array.isArray(provider?.urls) && provider.urls.length > 0) return provider.urls;
  if (provider?.url) return [provider.url];
  return [];
}

function vendorErrorMessage(error) {
  return error?.message || String(error || "vendor scrape failed");
}

function failedVendorResult({ coinSlug, coin, provider, url, error }) {
  return {
    coinSlug,
    coin,
    providerId: provider.id,
    url,
    price: null,
    source: "vendor-error",
    inStock: true,
    ok: false,
    error: vendorErrorMessage(error),
  };
}

function normalizeVendorResult(result, { coinSlug, coin, provider, url }) {
  if (!result || typeof result !== "object") {
    return failedVendorResult({
      coinSlug,
      coin,
      provider,
      url,
      error: "invalid_vendor_result",
    });
  }
  const price = result.price == null ? null : result.price;
  const inStock = result.inStock !== false;
  const ok = typeof result.ok === "boolean" ? result.ok : price !== null || !inStock;
  return {
    coinSlug: result.coinSlug || coinSlug,
    coin: result.coin || coin,
    providerId: result.providerId || provider.id,
    url: result.url || url,
    price,
    source: result.source || "unknown",
    inStock,
    ok,
    error: result.error || (ok ? null : "price_not_found"),
  };
}

async function resolveSingleVendorCoin(coinSlug, options = {}) {
  if (options.coin) return options.coin;
  if (options.providersJson?.coins?.[coinSlug]) return options.providersJson.coins[coinSlug];

  const providersJson = await loadProviders(null, options.dataDir || DATA_DIR);
  const coin = providersJson.coins?.[coinSlug];
  if (!coin) {
    throw new Error(`Coin not found for retry: ${coinSlug}`);
  }
  return coin;
}

export async function scrapeSingleVendor({
  coinSlug,
  coin,
  provider,
  url,
  urls,
  scrapeVendor: scrapeVendorFn = scrapeVendor,
  scrapeGeneric = scrapeGenericTarget,
  log: logFn = log,
  warn: warnFn = warn,
  config,
} = {}) {
  if (!coinSlug) throw new Error("coinSlug is required");
  if (!coin) throw new Error("coin is required");
  if (!provider?.id) throw new Error("provider.id is required");

  const singleUrls = providerUrls(provider, url, urls);
  if (singleUrls.length === 0) {
    throw new Error(`Provider URL is required for ${provider.id}/${coinSlug}`);
  }

  const providerForRun = {
    ...provider,
    url: singleUrls[0],
    urls: singleUrls,
  };

  return scrapeVendorFn({
    coinSlug,
    coin,
    provider: providerForRun,
    urls: singleUrls,
    url: singleUrls[0],
    config: config || providerCfg(providerForRun.id),
    scrapeGeneric,
    log: logFn,
    warn: warnFn,
  });
}

export async function extractPrice(url, coinSlug, providerId, provider = {}, options = {}) {
  const providerForRun = {
    ...provider,
    id: providerId || provider.id,
    url: url || provider.url,
  };
  const coin = await resolveSingleVendorCoin(coinSlug, options);

  return scrapeSingleVendor({
    ...options,
    coinSlug,
    coin,
    provider: providerForRun,
    url: providerForRun.url,
    urls: providerUrls(providerForRun, providerForRun.url, options.urls),
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runFullPoller(options = {}) {
  const isLocal = !FIRECRAWL_BASE_URL.includes("api.firecrawl.dev");
  // PLAYWRIGHT_LAUNCH=1 runs Chromium directly — no Firecrawl needed (home poller mode)
  if (!FIRECRAWL_API_KEY && !isLocal && !PLAYWRIGHT_LAUNCH) {
    console.error("Error: FIRECRAWL_API_KEY is required for cloud Firecrawl.");
    console.error("For self-hosted: set FIRECRAWL_BASE_URL=http://localhost:3002");
    console.error("For home poller (Playwright only): set PLAYWRIGHT_LAUNCH=1");
    process.exit(1);
  }

  const {
    openSqldDb,
    writeSnapshot,
    windowFloor,
    startRunLog,
    finishRunLog,
    recordFailure,
    readSpotCurrent,
  } = options.dbHelpers || (await loadDbHelpers());
  const scrapeVendorFn = options.scrapeVendor || scrapeVendor;
  const jitterFn = options.jitter || jitter;

  // Load providers from sqld (falls back to local file if sqld is down)
  let tursoClient = null;
  let providersJson = options.providersJson;
  if (!providersJson) {
    try {
      tursoClient = (await import("./sqld-client.js")).createSqldClient();
    } catch {}
    providersJson = await loadProviders(tursoClient, DATA_DIR);
  }

  // Build scrape targets — shuffled to avoid rate-limit fingerprinting
  const targets = [];
  for (const [coinSlug, coin] of Object.entries(providersJson.coins)) {
    if (COIN_FILTER && !COIN_FILTER.includes(coinSlug)) continue;
    for (const provider of coin.providers) {
      const providerUrls = provider.urls ?? (provider.url ? [provider.url] : []);
      if (!provider.enabled || providerUrls.length === 0) continue;
      targets.push({ coinSlug, coin, provider, urls: providerUrls });
    }
  }
  shuffleArray(targets);

  log(
    `Proxy config: HOME_PROXY_URL=${HOME_PROXY_URL ? "SET" : "NOT SET"}, PLAYWRIGHT_LAUNCH=${PLAYWRIGHT_LAUNCH}`
  );

  // Probe proxy health (non-blocking, non-fatal; informational only)
  if (HOME_PROXY_URL) {
    try {
      await fetch(HOME_PROXY_URL, { signal: AbortSignal.timeout(5000) });
      log(`Proxy probe: OK (${HOME_PROXY_URL})`);
    } catch {
      warn(`HOME_PROXY_URL unreachable (${HOME_PROXY_URL})`);
    }
  } else {
    log(`Proxy probe: skipped (HOME_PROXY_URL not set)`);
  }

  log(`Retail price extraction: ${targets.length} targets (sequential + jitter)`);
  if (DRY_RUN) log("DRY RUN — no SQLite writes");

  // Open SQLite for this run — closed in finally block to ensure cleanup on fatal errors
  const db = DRY_RUN ? null : await openSqldDb();
  const scrapedAt = new Date().toISOString();
  const winStart = windowFloor();

  // STAK-496: Load spot prices + goldback baseline for price bounds guard.
  // Computed once at startup — used by safeWriteSnapshot for each target.
  const _spotByMetal = {}; // { gold: 2650.00, silver: 31.50, ... }
  let _goldbackG1 = null; // goldback.com G1 rate in USD
  if (db) {
    try {
      const spotRows = await readSpotCurrent(db);
      for (const row of spotRows) {
        if (row.metal && row.spot != null) _spotByMetal[row.metal] = Number(row.spot);
      }
      log(
        `[bounds-guard] Spot prices loaded: ${
          Object.entries(_spotByMetal)
            .map(([m, p]) => `${m}=$${p}`)
            .join(", ") || "none"
        }`
      );
    } catch (err) {
      warn(`[bounds-guard] Spot prices unavailable (non-fatal): ${err.message.slice(0, 80)}`);
    }
    try {
      const gbPath = join(DATA_DIR, "api", "goldback-spot.json");
      if (existsSync(gbPath)) {
        const gb = JSON.parse(readFileSync(gbPath, "utf-8"));
        if (gb.g1_usd > 0) _goldbackG1 = gb.g1_usd;
      }
      if (
        _goldbackG1 == null &&
        typeof _spotByMetal.gold === "number" &&
        isFinite(_spotByMetal.gold)
      ) {
        _goldbackG1 = _spotByMetal.gold * 0.003085; // fallback: gold spot × G1 weight
      }
      if (_goldbackG1) log(`[bounds-guard] Goldback G1 baseline: $${_goldbackG1.toFixed(2)}`);
    } catch (err) {
      warn(`[bounds-guard] Goldback baseline unavailable (non-fatal): ${err.message.slice(0, 80)}`);
    }
  }

  /**
   * Compute the dynamic price baseline for a given coin.
   * @param {string} coinSlug
   * @param {object} coin  { metal, weight_oz }
   * @returns {number|null}  baseline price in USD, or null if unavailable
   */
  function computeBaseline(coinSlug, coin) {
    if (coin.metal === "goldback") {
      // Goldback denominations: g0.25, G1, G5, G10, G25, G50
      if (!_goldbackG1) return null;
      const denomMatch =
        coinSlug.match(/goldback-.*?-?g(\d+(?:\.\d+)?)$/i) ||
        coinSlug.match(/goldback-g(\d+(?:\.\d+)?)/i);
      const multiplier = denomMatch ? Number(denomMatch[1]) : 1;
      return _goldbackG1 * multiplier;
    }
    const spot = _spotByMetal[coin.metal];
    if (!spot || !coin.weight_oz) return null;
    return spot * coin.weight_oz;
  }

  // Start run log entry in sqld.
  // First, mark any orphaned "running" rows from previous crashed runs as "error".
  let runId = null;
  if (db) {
    try {
      await db.execute({
        sql: `UPDATE poller_runs SET status = 'error', error = 'orphaned — process crashed or was killed'
              WHERE poller_id = ? AND status = 'running'`,
        args: [POLLER_ID],
      });
      runId = await startRunLog(db, {
        pollerId: POLLER_ID,
        startedAt: scrapedAt,
        total: targets.length,
      });
    } catch (err) {
      warn(`Run log start failed (non-fatal): ${err.message.slice(0, 80)}`);
    }
  }

  try {
    // Scrape all targets sequentially with per-request jitter
    const scrapeResults = [];
    for (let targetIdx = 0; targetIdx < targets.length; targetIdx++) {
      const { coinSlug, coin, provider, urls } = targets[targetIdx];
      log(
        `Scraping ${coinSlug}/${provider.id}${urls.length > 1 ? ` (${urls.length} URL(s))` : ""}`
      );

      // STAK-496: Per-target bounds check params
      const _baseline = computeBaseline(coinSlug, coin);
      const _skipBounds = provider.skipPriceBounds === true;

      let result;
      try {
        result = normalizeVendorResult(
          await scrapeVendorFn({
            coinSlug,
            coin,
            provider,
            urls,
            url: urls[0],
            config: providerCfg(provider.id),
            scrapeGeneric: scrapeGenericTarget,
            log,
            warn,
          }),
          { coinSlug, coin, provider, url: urls[0] }
        );
      } catch (err) {
        warn(
          `${coinSlug}/${provider.id}: vendor scrape failed: ${vendorErrorMessage(err).slice(0, 120)}`
        );
        result = failedVendorResult({
          coinSlug,
          coin,
          provider,
          url: urls[0],
          error: err,
        });
      }

      scrapeResults.push(result);

      // Record to sqld
      if (db) {
        await safeWriteSnapshot(
          db,
          {
            scrapedAt,
            windowStart: winStart,
            coinSlug,
            vendor: provider.id,
            price: result.price,
            source: result.source,
            isFailed: result.price === null && result.inStock,
            baseline: _baseline,
            skipPriceBounds: _skipBounds,
            inStock: result.inStock,
          },
          writeSnapshot
        );

        // Record individual failure for failure queue (R10)
        if (result.price === null && result.inStock) {
          try {
            await recordFailure(db, {
              coinSlug,
              vendorId: provider.id,
              url: result.url || urls[0],
              error: result.error || "price_not_found",
              failedAt: scrapedAt,
            });
          } catch (err) {
            warn(`Failure log failed (non-fatal): ${err.message.slice(0, 80)}`);
          }
        }
      }

      // Jitter before next request (skip after last target)
      if (targetIdx < targets.length - 1) {
        await jitterFn();
      }
    }

    const ok = scrapeResults.filter((r) => r.ok).length;
    const fail = scrapeResults.length - ok;

    log(
      `Done: ${ok}/${scrapeResults.length} prices captured, ${fail} failures, ${_dbWriteFailures} DB write errors, cf-clearance: ${cfAttempts} attempts ${cfSuccess} ok ${cfFailures} failed`
    );

    // Finish run log entry in sqld
    if (db && runId) {
      try {
        const errorMsg =
          ok === 0
            ? "All scrapes failed"
            : _dbWriteFailures > 0
              ? `${_dbWriteFailures} DB write(s) failed`
              : null;
        await finishRunLog(db, {
          runId,
          finishedAt: new Date().toISOString(),
          captured: ok,
          failures: fail,
          fbpFilled: 0,
          error: errorMsg,
        });
      } catch (err) {
        warn(`Run log finish failed (non-fatal): ${err.message.slice(0, 80)}`);
      }
    }

    if (ok === 0) {
      console.error("All scrapes failed.");
      process.exit(1);
    }
  } finally {
    if (db) db.close();
  }
}

function isDirectCliInvocation() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isDirectCliInvocation()) {
  runFullPoller().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}

/**
 * Webscale "Protection Mode" cookie store (STRK-230).
 *
 * JM Bullion and Provident Metals (both A-Mark/JMB properties, shared front end)
 * sit behind **Webscale** — NOT Cloudflare — which throws a Google reCAPTCHA v2
 * interstitial on product pages. Byparr/Firecrawl cannot solve it. The only
 * no-cost bypass is to clone a `wspc` cookie ("WebScale Protection Cookie",
 * ~7-day life) that an operator solves manually in a browser on the SAME public
 * IP as the poller, then inject it into the poller's headless Chromium with a
 * matching user-agent. Webscale binds clearance to IP + Chrome-class UA + wspc.
 *
 * This is a deliberately temporary stopgap that needs a manual re-solve roughly
 * weekly per site. See the issue for the durable plan (proxy / solver / FBP).
 *
 * Storage: a JSON map keyed by hostname:
 *   { "www.jmbullion.com": { "wspc": "...", "userAgent": "...", "updatedAt": "..." } }
 *
 * The file path comes from WEBSCALE_COOKIE_FILE. On the home poller set it to a
 * path OUTSIDE any git checkout (e.g. /data/webscale-cookies.json) so live
 * cookies are never committed to the data branch. The default is module-local
 * for dev/tests; `.gitignore` also guards the filename as defense-in-depth.
 *
 * CLI:
 *   node webscale-cookies.js set <hostname> <wspc> "<userAgent>"
 *   node webscale-cookies.js list
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve the cookie store path, honoring the WEBSCALE_COOKIE_FILE override. */
export function webscaleCookieFilePath(env = process.env) {
  return env.WEBSCALE_COOKIE_FILE || join(__dirname, "webscale-cookies.json");
}

/** Read and parse the whole store. Returns {} on any missing/unreadable file. */
export function loadWebscaleStore(env = process.env) {
  const file = webscaleCookieFilePath(env);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Corrupt store should degrade to "no cookie" (poller falls through to
    // Firecrawl/FBP), never crash the run.
    return {};
  }
}

/**
 * Load the injectable cookie for a hostname.
 * @returns {{ wspc: string, userAgent: string|null, updatedAt: string|null } | null}
 *   null when the host is absent or its wspc value is missing/empty.
 */
export function loadWebscaleCookie(hostname, env = process.env) {
  if (!hostname) return null;
  const entry = loadWebscaleStore(env)[hostname];
  if (!entry || typeof entry.wspc !== "string" || entry.wspc.length === 0) return null;
  return {
    wspc: entry.wspc,
    userAgent:
      typeof entry.userAgent === "string" && entry.userAgent.length > 0 ? entry.userAgent : null,
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
  };
}

/** Upsert a hostname's cookie + solving UA, stamping updatedAt. */
export function setWebscaleCookie(hostname, wspc, userAgent, env = process.env, now = new Date()) {
  if (!hostname || !wspc) throw new Error("setWebscaleCookie: hostname and wspc are required");
  const file = webscaleCookieFilePath(env);
  const store = loadWebscaleStore(env);
  store[hostname] = {
    wspc,
    userAgent: userAgent || null,
    updatedAt: now.toISOString(),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return store[hostname];
}

/**
 * True when page content (raw HTML or innerText) is a Webscale "Protection Mode"
 * reCAPTCHA interstitial rather than a real page — i.e. the wspc cookie is
 * missing/stale and a re-solve is needed. Distinct from the Cloudflare patterns
 * in looksLikeChallengePage().
 */
export function looksLikeWebscaleChallenge(content) {
  if (!content) return false;
  return /confirm your humanity|\/\.webscale\/i-am-a-human|resources\.webscale\.com|protection-mode-captcha/i.test(
    content
  );
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "set") {
    const [hostname, wspc, userAgent] = rest;
    if (!hostname || !wspc) {
      console.error('Usage: node webscale-cookies.js set <hostname> <wspc> "<userAgent>"');
      process.exit(1);
    }
    if (!userAgent) {
      console.warn("WARNING: no userAgent given — clearance is UA-bound, this will likely fail.");
    }
    const saved = setWebscaleCookie(hostname, wspc, userAgent);
    console.log(
      `Saved wspc for ${hostname} (UA ${saved.userAgent ? "set" : "MISSING"}) -> ${webscaleCookieFilePath()}`
    );
  } else if (cmd === "list") {
    const store = loadWebscaleStore();
    const hosts = Object.keys(store);
    if (hosts.length === 0) {
      console.log(`(empty) ${webscaleCookieFilePath()}`);
    } else {
      for (const h of hosts) {
        const e = store[h];
        console.log(
          `${h}\twspc=${(e.wspc || "").slice(0, 8)}…\tUA=${e.userAgent ? "set" : "MISSING"}\tupdated=${e.updatedAt || "?"}`
        );
      }
    }
  } else {
    console.error("Usage: node webscale-cookies.js <set|list> …");
    process.exit(1);
  }
}

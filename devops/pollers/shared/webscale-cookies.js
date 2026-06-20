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
 * Two storage backends, env wins over file:
 *
 *   1. Environment variables (recommended for the home poller — Portainer path).
 *      Per host: WEBSCALE_WSPC_<HOST> and WEBSCALE_UA_<HOST>, where <HOST> is the
 *      hostname upper-cased with non-alphanumerics → "_" (see webscaleEnvKeys).
 *      e.g. WEBSCALE_WSPC_WWW_JMBULLION_COM / WEBSCALE_UA_WWW_JMBULLION_COM.
 *      The entrypoint dumps Docker env into /etc/environment and the scrape cron
 *      sources it as shell, so a pasted var reaches the poller after a container
 *      recreate. The UA value is **base64** (see encodeUaForEnv) — a raw UA's
 *      spaces/parens/semicolons would be a shell syntax error when sourced.
 *
 *   2. JSON file keyed by hostname (dev / file-based deploys):
 *      { "www.jmbullion.com": { "wspc": "...", "userAgent": "...", "updatedAt": "..." } }
 *      Path from WEBSCALE_COOKIE_FILE (default module-local). Point it OUTSIDE any
 *      git checkout on the poller; `.gitignore` also guards the filename.
 *
 * Re-solving (weekly): run the interactive helper on a machine sharing the
 * poller's public IP — `node webscale-solve.mjs` — solve each captcha once, and
 * it prints the env lines to paste into Portainer. Manual CLI alternatives:
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
 * Per-host environment variable names. Derived from the hostname so there is no
 * mapping table to keep in sync — e.g. www.jmbullion.com →
 * { wspcKey: "WEBSCALE_WSPC_WWW_JMBULLION_COM", uaKey: "WEBSCALE_UA_WWW_JMBULLION_COM" }.
 * The solve helper prints these so they can be pasted straight into Portainer.
 */
export function webscaleEnvKeys(hostname) {
  const suffix = String(hostname || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  return { wspcKey: `WEBSCALE_WSPC_${suffix}`, uaKey: `WEBSCALE_UA_${suffix}` };
}

/**
 * The UA env value MUST be base64 — the home-poller entrypoint writes Docker env
 * to /etc/environment and the cron jobs `. ` (source) that file as shell. A raw
 * UA ("Mozilla/5.0 (Windows NT 10.0; ...)") has spaces, parens and semicolons,
 * which is a shell syntax error that breaks env for the whole scrape job. wspc
 * tokens are already shell-safe, so only the UA is encoded.
 */
export function encodeUaForEnv(ua) {
  return ua ? Buffer.from(ua, "utf8").toString("base64") : "";
}

/** Decode a UA env value. Falls back to the raw string if it is not base64
 *  (e.g. a hand-set plain UA), detected via a round-trip re-encode. */
function decodeUaFromEnv(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  const strip = (s) => s.replace(/=+$/, "");
  if (decoded && strip(Buffer.from(decoded, "utf8").toString("base64")) === strip(value)) {
    return decoded;
  }
  return value;
}

/**
 * Load the injectable cookie for a hostname. Environment variables win over the
 * file store so the operator can paste a fresh cookie into Portainer and
 * recreate the container without touching a file inside it (the entrypoint dumps
 * the Docker env into /etc/environment, which the scrape cron sources).
 * @returns {{ wspc: string, userAgent: string|null, updatedAt: string|null, source: string } | null}
 *   null when neither env nor file provides a non-empty wspc.
 */
export function loadWebscaleCookie(hostname, env = process.env) {
  if (!hostname) return null;

  // 1) Environment variables (Portainer-friendly path).
  const { wspcKey, uaKey } = webscaleEnvKeys(hostname);
  const envWspc = env[wspcKey];
  if (typeof envWspc === "string" && envWspc.length > 0) {
    return {
      wspc: envWspc,
      userAgent: decodeUaFromEnv(env[uaKey]),
      updatedAt: "env",
      source: "env",
    };
  }

  // 2) File store fallback (dev / file-based deploys).
  const entry = loadWebscaleStore(env)[hostname];
  if (!entry || typeof entry.wspc !== "string" || entry.wspc.length === 0) return null;
  return {
    wspc: entry.wspc,
    userAgent:
      typeof entry.userAgent === "string" && entry.userAgent.length > 0 ? entry.userAgent : null,
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
    source: "file",
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
  // mode 0600: the file holds live bot-clearance credentials.
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return store[hostname];
}

// Markers of the Webscale "Protection Mode" reCAPTCHA interstitial. Kept free of
// escaped forward slashes (i-am-a-human, not /.webscale/i-am-a-human) so static
// analyzers don't mis-tokenize the literal.
const WEBSCALE_CHALLENGE_RE =
  /confirm your humanity|i-am-a-human|resources\.webscale\.com|protection-mode-captcha/i;

/**
 * True when page content (raw HTML or innerText) is a Webscale "Protection Mode"
 * reCAPTCHA interstitial rather than a real page — i.e. the wspc cookie is
 * missing/stale and a re-solve is needed. Distinct from the Cloudflare patterns
 * in looksLikeChallengePage().
 */
export function looksLikeWebscaleChallenge(content) {
  if (!content) return false;
  return WEBSCALE_CHALLENGE_RE.test(content);
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
        const raw = store[h];
        const e = raw && typeof raw === "object" ? raw : {};
        const wspcPrefix = typeof e.wspc === "string" ? e.wspc.slice(0, 8) : "";
        console.log(
          `${h}\twspc=${wspcPrefix}…\tUA=${e.userAgent ? "set" : "MISSING"}\tupdated=${e.updatedAt || "?"}`
        );
      }
    }
  } else {
    console.error("Usage: node webscale-cookies.js <set|list> …");
    process.exit(1);
  }
}

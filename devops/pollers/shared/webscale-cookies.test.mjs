#!/usr/bin/env node
// Tests for webscale-cookies.js — run with:
//   node devops/pollers/shared/webscale-cookies.test.mjs
//
// Covers the per-hostname wspc cookie store (load/set round-trip, robustness)
// and the Webscale "Protection Mode" challenge detector used to flag a stale or
// missing cookie (STRK-230).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadWebscaleCookie,
  setWebscaleCookie,
  webscaleCookieFilePath,
  webscaleEnvKeys,
  looksLikeWebscaleChallenge,
} from "./webscale-cookies.js";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  PASS ", name);
    passed++;
  } catch (err) {
    console.log("  FAIL ", name, "-", err.message);
    failed++;
  }
}
function eq(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e} got ${a}`);
}

// Each call gets an isolated cookie file under a fresh temp dir so tests never
// touch the real store or each other.
function tmpEnv() {
  const dir = mkdtempSync(join(tmpdir(), "wspc-"));
  return { env: { WEBSCALE_COOKIE_FILE: join(dir, "webscale-cookies.json") } };
}

console.log("--- webscaleCookieFilePath ---");
test("honors WEBSCALE_COOKIE_FILE env override", () => {
  eq(webscaleCookieFilePath({ WEBSCALE_COOKIE_FILE: "/data/webscale-cookies.json" }), "/data/webscale-cookies.json");
});
test("falls back to a module-local default when unset", () => {
  const p = webscaleCookieFilePath({});
  eq(p.endsWith("webscale-cookies.json"), true);
});

console.log("\n--- loadWebscaleCookie (absent) ---");
test("missing file → null", () => {
  eq(loadWebscaleCookie("www.jmbullion.com", tmpEnv().env), null);
});
test("null / empty hostname → null", () => {
  const { env } = tmpEnv();
  eq(loadWebscaleCookie(null, env), null);
  eq(loadWebscaleCookie("", env), null);
});

console.log("\n--- set + load round-trip ---");
test("set then load returns wspc + UA + timestamp", () => {
  const { env } = tmpEnv();
  setWebscaleCookie("www.jmbullion.com", "ABC123", "UA/1.0", env, new Date("2026-06-19T00:00:00Z"));
  const got = loadWebscaleCookie("www.jmbullion.com", env);
  eq(got.wspc, "ABC123");
  eq(got.userAgent, "UA/1.0");
  eq(got.updatedAt, "2026-06-19T00:00:00.000Z");
});
test("unknown hostname in a populated store → null", () => {
  const { env } = tmpEnv();
  setWebscaleCookie("www.jmbullion.com", "ABC", "UA", env);
  eq(loadWebscaleCookie("www.providentmetals.com", env), null);
});
test("two hosts coexist independently", () => {
  const { env } = tmpEnv();
  setWebscaleCookie("www.jmbullion.com", "JM", "UA1", env);
  setWebscaleCookie("www.providentmetals.com", "PV", "UA2", env);
  eq(loadWebscaleCookie("www.jmbullion.com", env).wspc, "JM");
  eq(loadWebscaleCookie("www.providentmetals.com", env).wspc, "PV");
});
test("re-set overwrites the same host", () => {
  const { env } = tmpEnv();
  setWebscaleCookie("www.jmbullion.com", "OLD", "UA", env);
  setWebscaleCookie("www.jmbullion.com", "NEW", "UA", env);
  eq(loadWebscaleCookie("www.jmbullion.com", env).wspc, "NEW");
});

console.log("\n--- robustness ---");
test("malformed JSON → null (no throw)", () => {
  const { env } = tmpEnv();
  writeFileSync(env.WEBSCALE_COOKIE_FILE, "{not json", "utf8");
  eq(loadWebscaleCookie("www.jmbullion.com", env), null);
});
test("entry missing wspc → null", () => {
  const { env } = tmpEnv();
  writeFileSync(env.WEBSCALE_COOKIE_FILE, JSON.stringify({ "www.jmbullion.com": { userAgent: "UA" } }), "utf8");
  eq(loadWebscaleCookie("www.jmbullion.com", env), null);
});
test("empty wspc string → null", () => {
  const { env } = tmpEnv();
  writeFileSync(env.WEBSCALE_COOKIE_FILE, JSON.stringify({ "www.jmbullion.com": { wspc: "", userAgent: "UA" } }), "utf8");
  eq(loadWebscaleCookie("www.jmbullion.com", env), null);
});
test("missing userAgent → wspc still returned, userAgent null", () => {
  const { env } = tmpEnv();
  writeFileSync(env.WEBSCALE_COOKIE_FILE, JSON.stringify({ "www.jmbullion.com": { wspc: "X" } }), "utf8");
  const got = loadWebscaleCookie("www.jmbullion.com", env);
  eq(got.wspc, "X");
  eq(got.userAgent, null);
});
test("set requires hostname and wspc", () => {
  const { env } = tmpEnv();
  let threw = 0;
  try { setWebscaleCookie("", "x", "UA", env); } catch { threw++; }
  try { setWebscaleCookie("h", "", "UA", env); } catch { threw++; }
  eq(threw, 2);
});

console.log("\n--- webscaleEnvKeys ---");
test("derives per-host env var names from hostname", () => {
  eq(webscaleEnvKeys("www.jmbullion.com"), {
    wspcKey: "WEBSCALE_WSPC_WWW_JMBULLION_COM",
    uaKey: "WEBSCALE_UA_WWW_JMBULLION_COM",
  });
});

console.log("\n--- env-var source (Portainer path) ---");
test("env var wspc + UA wins and reports source=env", () => {
  const got = loadWebscaleCookie("www.jmbullion.com", {
    WEBSCALE_WSPC_WWW_JMBULLION_COM: "ENVWSPC",
    WEBSCALE_UA_WWW_JMBULLION_COM: "ENV/UA",
  });
  eq(got.wspc, "ENVWSPC");
  eq(got.userAgent, "ENV/UA");
  eq(got.source, "env");
});
test("env var wspc overrides the file store", () => {
  const { env } = tmpEnv();
  setWebscaleCookie("www.jmbullion.com", "FILEWSPC", "FILE/UA", env);
  const got = loadWebscaleCookie("www.jmbullion.com", {
    ...env,
    WEBSCALE_WSPC_WWW_JMBULLION_COM: "ENVWSPC",
  });
  eq(got.wspc, "ENVWSPC");
  eq(got.source, "env");
});
test("empty env var falls through to file store", () => {
  const { env } = tmpEnv();
  setWebscaleCookie("www.jmbullion.com", "FILEWSPC", "FILE/UA", env);
  const got = loadWebscaleCookie("www.jmbullion.com", {
    ...env,
    WEBSCALE_WSPC_WWW_JMBULLION_COM: "",
  });
  eq(got.wspc, "FILEWSPC");
  eq(got.source, "file");
});

console.log("\n--- looksLikeWebscaleChallenge ---");
test("real product innerText → false", () => {
  eq(looksLikeWebscaleChallenge("1 oz American Gold Eagle  Price $4,269.17  Add to Cart"), false);
});
test("null / empty → false", () => {
  eq(looksLikeWebscaleChallenge(null), false);
  eq(looksLikeWebscaleChallenge(""), false);
});
test("'confirm your humanity' innerText → true", () => {
  eq(looksLikeWebscaleChallenge("Please confirm your humanity. We are temporarily requesting additional verification"), true);
});
test("/.webscale/i-am-a-human marker → true", () => {
  eq(looksLikeWebscaleChallenge('xhr.open("POST", "/.webscale/i-am-a-human")'), true);
});
test("resources.webscale.com errorpage marker → true", () => {
  eq(looksLikeWebscaleChallenge('<link href="https://resources.webscale.com/css/errorpage.css">'), true);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

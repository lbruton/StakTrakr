#!/usr/bin/env node
/**
 * Interactive Webscale re-solve helper (STRK-230).
 *
 * The weekly ritual: JM Bullion / Provident sit behind Webscale Protection Mode
 * (Google reCAPTCHA v2 on product pages). The bypass is a cloned ~7-day `wspc`
 * cookie. This helper opens a real browser so you can solve the captcha once per
 * site, then captures the cleared `wspc` AND the exact user-agent and prints
 * lines you paste straight into the home poller's Portainer env (then recreate
 * the container). No DevTools, no manual cookie hunting, UA-match guaranteed.
 *
 * MUST run on a machine sharing the poller's public IP (your home network), with
 * a display. Requires Playwright's browser once: `npx playwright install chromium`.
 *
 *   node devops/pollers/shared/webscale-solve.mjs
 *   node devops/pollers/shared/webscale-solve.mjs --write   # also write the file store
 *   node devops/pollers/shared/webscale-solve.mjs https://www.jmbullion.com/  # custom start URLs
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import {
  setWebscaleCookie,
  webscaleEnvKeys,
  looksLikeWebscaleChallenge,
} from "./webscale-cookies.js";

// Hosts to solve. Start URLs are just a landing point — navigate to any PRODUCT
// page in the window to trigger (and solve) the challenge; the cleared wspc is
// site-wide, so the exact product does not matter.
const DEFAULT_TARGETS = [
  { host: "www.jmbullion.com", start: "https://www.jmbullion.com/1-oz-american-gold-eagle/" },
  { host: "www.providentmetals.com", start: "https://www.providentmetals.com/" },
];

const args = process.argv.slice(2);
const writeFile = args.includes("--write");
const urlArgs = args.filter((a) => a.startsWith("http"));
const targets = urlArgs.length
  ? urlArgs.map((u) => ({ host: new URL(u).hostname, start: u }))
  : DEFAULT_TARGETS;

const rl = createInterface({ input: stdin, output: stdout });
const envLines = [];

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

for (const { host, start } of targets) {
  console.log(`\n=== ${host} ===`);
  try {
    await page.goto(start, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch {
    console.log(`  (could not auto-open ${start} — navigate there manually)`);
  }
  console.log(`  In the browser: open ANY product page on ${host} and solve the`);
  console.log(`  "confirm your humanity" check so the product actually loads.`);
  await rl.question("  Press Enter once the product page is showing… ");

  let content = "";
  try {
    content = await page.content();
  } catch {
    /* mid-navigation; ignore */
  }
  if (looksLikeWebscaleChallenge(content)) {
    console.log("  ⚠️ That page still looks like the challenge. Solve it, then…");
    await rl.question("  Press Enter to retry capture… ");
    content = await page.content().catch(() => "");
  }

  const cookies = await context.cookies(`https://${host}/`);
  const wspc = cookies.find((c) => c.name === "wspc")?.value;
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => null);

  if (!wspc) {
    console.log(`  ❌ No wspc cookie found for ${host} — skipped. (Did the page load?)`);
    continue;
  }
  const { wspcKey, uaKey } = webscaleEnvKeys(host);
  envLines.push(`${wspcKey}=${wspc}`, `${uaKey}=${ua || ""}`);
  console.log(`  ✅ captured wspc (${wspc.slice(0, 10)}…) + UA ${ua ? "✓" : "MISSING"}`);
  if (writeFile) {
    setWebscaleCookie(host, wspc, ua);
    console.log("  ✅ also written to the file store");
  }
}

rl.close();
await browser.close();

if (envLines.length) {
  console.log("\n──────── paste into Portainer env, then RECREATE the container ────────");
  for (const line of envLines) console.log(line);
  console.log("───────────────────────────────────────────────────────────────────────");
} else {
  console.log("\nNothing captured.");
}

/**
 * Captures the screens listed in shots.json from demo data and recorded API responses.
 * Run through `npm run screenshots`; it is not part of any test suite.
 */
/* global APP_VERSION */

import { test, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_INVENTORY, DEMO_LINKS, DEMO_SETTINGS } from "./demo-data.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const HAR_PATH = path.join(HERE, "fixtures", "api.har.zip");
const META_PATH = path.join(HERE, "fixtures", "recorded.json");
const CONFIG = JSON.parse(readFileSync(path.join(HERE, "shots.json"), "utf8"));
const THEMES = new Set(["light", "dark", "slate", "sepia"]);
const RECORD = process.env.SHOTS_RECORD === "1";
const SET = process.env.SHOTS_SET || "site";
const VERSION = process.env.SHOTS_VERSION || "";
const ONLY = (process.env.SHOTS_ONLY || "").split(",").filter(Boolean);
// Time between the last step and the capture, so charts finish drawing.
const SETTLE_MS = 800;
// Hides the environment badge and the text caret, which vary by host and focus.
const CAPTURE_CSS =
  ".env-badge { display: none !important; } * { caret-color: transparent !important; }";

/**
 * Picks the shots for this run. A record run takes every shot, so the recording
 * holds the requests of both sets.
 * @returns {object[]}
 */
function selectShots() {
  if (RECORD) return CONFIG.shots;
  const shots = CONFIG.shots.filter((shot) => shot.set === SET);
  const unknown = ONLY.filter((name) => !shots.some((shot) => shot.name === name));
  if (unknown.length) throw new Error(`Unknown ${SET} shots: ${unknown.join(", ")}`);
  return ONLY.length ? shots.filter((shot) => ONLY.includes(shot.name)) : shots;
}

/**
 * Returns where a shot is written.
 * @param {object} shot - Shot entry from shots.json.
 * @returns {string}
 */
function outputPath(shot) {
  if (shot.set === "release") {
    // A record run has no version; its release shots only check that the steps still work.
    if (!VERSION) return path.join(REPO_ROOT, "test-results", "screenshots", `${shot.name}.png`);
    return path.join(REPO_ROOT, "docs", "announcements", "images", `${VERSION}-${shot.name}.png`);
  }
  return path.join(REPO_ROOT, "screenshots", `${shot.name}.png`);
}

/**
 * Returns the moment the recorded API responses describe, so dates and ages match them.
 * @returns {Date}
 */
function captureTime() {
  if (RECORD) return new Date();
  return new Date(JSON.parse(readFileSync(META_PATH, "utf8")).recordedAt);
}

/**
 * Seeds the demo inventory on the first load only, and hides first-run popups.
 * @param {import('@playwright/test').BrowserContext} context - Capture context.
 */
async function seedDemoData(context) {
  await context.addInitScript(
    ([inventory, settings]) => {
      if (!localStorage.getItem("metalInventory")) {
        localStorage.setItem("metalInventory", JSON.stringify(inventory));
        localStorage.setItem("inventorySerial", String(inventory.length));
        localStorage.setItem("inventorySeedApplied", new Date().toISOString());
        for (const [key, value] of Object.entries(settings)) {
          localStorage.setItem(key, JSON.stringify(value));
        }
      }
      sessionStorage.setItem("envToastShown", "1");
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
          // Chart.js times animations with Date.now(), which the fixed clock stops at frame zero.
          if (window.Chart) window.Chart.defaults.animation = false;
        },
        { once: true }
      );
    },
    [DEMO_INVENTORY, DEMO_SETTINGS]
  );
}

/**
 * Loads the app shell fresh and waits for boot. A goto that changes only the hash
 * would skip the init scripts, so the page leaves the app first.
 * @param {import('@playwright/test').Page} page - Capture page.
 * @param {string} route - Hash route such as `#/collections`.
 */
async function openApp(page, route) {
  await page.goto("about:blank");
  await page.goto(`/index.html${route || ""}`);
  await page.waitForFunction(() => window.appListenersReady === true, null, { timeout: 30000 });
  await page.addStyleTag({ content: CAPTURE_CSS });
}

/**
 * Runs one step from a shot's step list.
 * @param {import('@playwright/test').Page} page - Capture page.
 * @param {object} step - `{click}`, `{wait}` or `{call, args}`.
 */
async function runStep(page, step) {
  if (step.click) {
    await page.locator(step.click).first().click();
  } else if (step.wait) {
    await expect(page.locator(step.wait).first()).toBeVisible();
  } else if (step.call) {
    await page.evaluate(
      ([name, args]) => {
        if (typeof window[name] !== "function") throw new Error(`${name} is not a function`);
        return window[name](...args);
      },
      [step.call, step.args || []]
    );
  } else {
    throw new Error(`Unknown step: ${JSON.stringify(step)}`);
  }
}

/**
 * Brings the page to the shot's state and writes the image.
 * @param {import('@playwright/test').Page} page - Capture page.
 * @param {object} shot - Shot entry from shots.json.
 */
async function captureShot(page, shot) {
  if (!THEMES.has(shot.theme)) throw new Error(`${shot.name}: unknown theme ${shot.theme}`);
  const viewport = CONFIG.viewports[shot.viewport];
  if (!viewport) throw new Error(`${shot.name}: unknown viewport ${shot.viewport}`);
  await page.setViewportSize(viewport);
  await page.evaluate((theme) => localStorage.setItem("appTheme", theme), shot.theme);
  await openApp(page, shot.route);
  for (const step of shot.steps || []) await runStep(page, step);
  const target = page.locator(shot.target).first();
  await expect(target).toBeVisible();
  await page.waitForLoadState("networkidle");
  // A modal focuses its close button on open; the focus ring is not part of the screen.
  await page.evaluate(() => document.activeElement?.blur());
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE_MS);
  const file = outputPath(shot);
  mkdirSync(path.dirname(file), { recursive: true });
  if (shot.clip === "element") {
    await target.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: shot.clip === "full" });
  }
}

test.describe.serial("screenshots", () => {
  let context;
  let page;
  const at = captureTime();

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext(test.info().project.use);
    await context.routeFromHAR(HAR_PATH, {
      url: /^https:\/\//,
      update: RECORD,
      updateMode: "minimal",
      notFound: "abort",
    });
    // Every https request outside the recording is aborted, so a run never reaches the network.
    await seedDemoData(context);
    page = await context.newPage();
    await page.clock.setFixedTime(at);
    await openApp(page, "#/dashboard");
    await page.waitForFunction(() => !!window.collectionsStore);
    await page.evaluate((links) => {
      for (const [slug, slot, uuid] of links) window.collectionsStore.link(slug, slot, uuid);
    }, DEMO_LINKS);
  });

  test.afterAll(async () => {
    await context?.close();
    if (RECORD) {
      writeFileSync(META_PATH, `${JSON.stringify({ recordedAt: at.toISOString() }, null, 2)}\n`);
    }
  });

  for (const shot of selectShots()) {
    test(shot.name, async () => {
      await captureShot(page, shot);
    });
  }
});

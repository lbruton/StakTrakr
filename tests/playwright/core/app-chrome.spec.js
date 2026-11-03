// App chrome: the footer is text links and a status line with no images, the environment tag
// is an outlined label in the secondary text colour, and the header's Theme and Settings
// buttons are unboxed icons with a 44px hit area that show their labels only on request.

import { test, expect } from "../helpers/mocks/extended-test.js";
import { suppressWhatsNewPopup } from "../helpers/seed.js";

const THEMES = ["light", "dark", "slate", "sepia"];

/** Boots the app and waits for the footer status to leave its checking state. */
async function gotoApp(page) {
  await suppressWhatsNewPopup(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.appListenersReady === true);
  await expect(page.locator("#apiHealthBadge")).not.toHaveAttribute("data-state", "checking", {
    timeout: 15000,
  });
}

/**
 * Returns the WCAG contrast of each selector's colour property (text colour, or a background
 * for a dot) over the footer or header frame it sits in.
 */
function readChromeContrast(page, targets) {
  return page.evaluate((list) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const rgb = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const lum = (c) =>
      c
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    return list.map(([selector, prop]) => {
      const el = document.querySelector(selector);
      const frame = el.closest(".app-footer, .app-header");
      const [hi, lo] = [
        lum(rgb(getComputedStyle(el)[prop])),
        lum(rgb(getComputedStyle(frame).backgroundColor)),
      ].sort((a, b) => b - a);
      return { selector, ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 };
    });
  }, targets);
}

test.describe("app chrome", () => {
  test("the footer loads no images and keeps every link", async ({ page }) => {
    const imageRequests = [];
    page.on("request", (req) => {
      if (/shields\.io|codacy\.com\/project\/badge/.test(req.url())) imageRequests.push(req.url());
    });
    await gotoApp(page);

    await expect(page.locator(".app-footer img")).toHaveCount(0);
    expect(imageRequests).toEqual([]);
    const links = page.locator(".app-footer a[href]");
    const hrefs = await links.evaluateAll((els) => els.map((a) => a.getAttribute("href")));
    for (const url of [
      "https://github.com/lbruton/StakTrakr",
      "https://github.com/lbruton/StakTrakr/issues",
      "https://www.reddit.com/r/staktrakr/",
      "https://github.com/lbruton/StakTrakr/blob/main/LICENSE",
      "https://github.com/sponsors/lbruton",
      "https://beta.staktrakr.com",
    ]) {
      expect(hrefs).toContain(url);
    }

    await page.locator(".app-footer").getByRole("button", { name: "FAQ" }).click();
    await expect(page.locator("#settingsPanel_faq")).toBeVisible();
  });

  test("the footer puts thanks over copyright on the left, links over status on the right", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page);
    const layout = await page.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const footer = box(".app-footer");
      const middle = footer.left + footer.width / 2;
      const thanks = box(".footer-thanks");
      const meta = box(".footer-meta");
      const links = box(".footer-links");
      const status = box("#apiHealthBadge");
      const link = (name) =>
        [...document.querySelectorAll(".app-footer .footer-link")]
          .find((el) => el.textContent.trim() === name)
          .getBoundingClientRect();
      const beta = link("Beta site");
      const github = link("GitHub");
      const sepBetween = [...document.querySelectorAll(".footer-links .footer-sep")].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left >= beta.right && r.right <= github.left;
      });
      return {
        thanksLeft: thanks.right <= middle,
        metaUnderThanks: meta.top >= thanks.bottom && meta.right <= middle,
        linksRight: links.left >= middle,
        statusUnderLinks: status.top >= links.bottom && status.left >= middle,
        statusFlushRight:
          footer.right - document.querySelector(".footer-side").getBoundingClientRect().right < 32,
        sepBetween,
        underlined: [...document.querySelectorAll(".footer-meta a")].map(
          (a) => getComputedStyle(a).textDecorationLine
        ),
        thanksText: document
          .querySelector(".footer-thanks")
          .textContent.replace(/\s+/g, " ")
          .trim(),
      };
    });
    expect(layout).toEqual({
      thanksLeft: true,
      metaUnderThanks: true,
      linksRight: true,
      statusUnderLinks: true,
      statusFlushRight: true,
      sepBetween: true,
      underlined: ["none", "none"],
      thanksText: expect.stringMatching(/^Thank you for using StakTrakr\b.{40,}/),
    });
  });

  test("the footer status names the price state in words and opens API health", async ({
    page,
  }) => {
    await gotoApp(page);
    const status = page.locator("#apiHealthBadge");

    await expect(status).toHaveAttribute("data-state", "ok");
    await expect(page.locator("#apiHealthLabel")).toHaveText("Prices current");
    await expect(page.locator("#apiHealthValue")).toHaveText(
      /^Market (?:just now|\S+ ago) · Spot (?:just now|\S+ ago)$/
    );
    await expect(status.locator(".footer-dot")).toBeVisible();

    await status.click();
    await expect(page.locator("#apiHealthModal")).toBeVisible();
  });

  test("the footer shows the running version and an available update", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("lastVersionCheck", String(Date.now()));
      localStorage.setItem("latestRemoteVersion", "99.0.0");
      localStorage.setItem("latestRemoteUrl", "https://github.com/lbruton/StakTrakr/releases/x");
    });
    await gotoApp(page);
    const appVersion = await page.evaluate(() => window.APP_VERSION);

    await expect(page.locator("#versionBadgeValue")).toHaveText(`v${appVersion}`);
    await expect(page.locator("#versionUpdate")).toHaveText("v99.0.0 available");
    await expect(page.locator("#versionBadge")).toHaveAttribute(
      "href",
      "https://github.com/lbruton/StakTrakr/releases/x"
    );
  });

  test("the environment tag is an outlined label in the secondary text colour", async ({
    page,
  }) => {
    await gotoApp(page);
    const tag = page.locator("#envBadge");
    await expect(tag).toHaveText("LOCAL");
    const style = await tag.evaluate((el) => {
      const cs = getComputedStyle(el);
      const probe = document.createElement("span");
      probe.style.color = "var(--text-secondary)";
      el.parentElement.append(probe);
      const secondary = getComputedStyle(probe).color;
      probe.remove();
      return {
        background: cs.backgroundColor,
        borderWidth: cs.borderTopWidth,
        colourIsSecondary: cs.color === secondary,
      };
    });
    expect(style).toEqual({
      background: "rgba(0, 0, 0, 0)",
      borderWidth: "1px",
      colourIsSecondary: true,
    });
  });

  test("the header buttons are unboxed 44px icons, with labels only on request", async ({
    page,
  }) => {
    await gotoApp(page);
    const buttons = page.locator("#headerBtnContainer .header-toggle-btn:visible");
    await expect(buttons).toHaveCount(2);
    const boxes = await buttons.evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          unboxed: cs.borderTopWidth === "0px" && cs.backgroundColor === "rgba(0, 0, 0, 0)",
          target: Math.min(r.width, r.height) >= 44,
          label: getComputedStyle(el.querySelector(".header-btn-text")).display,
        };
      })
    );
    for (const box of boxes) expect(box).toEqual({ unboxed: true, target: true, label: "none" });

    await page.evaluate(() => {
      localStorage.setItem("headerBtnShowText", "true");
      window.applyHeaderToggleVisibility();
    });
    await expect(buttons.first().locator(".header-btn-text")).toBeVisible();
  });

  test("footer and environment text meet AA and the status dot meets 3:1 in every theme", async ({
    page,
  }) => {
    await gotoApp(page);
    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await page.evaluate((name) => window.setTheme(name), theme);
        await page.addStyleTag({ content: "* { transition: none !important; }" });
        const ratios = await readChromeContrast(page, [
          ["#apiHealthLabel", "color"],
          ["#apiHealthValue", "color"],
          [".app-footer .footer-link", "color"],
          [".footer-meta", "color"],
          [".footer-thanks", "color"],
          ["#envBadge", "color"],
          ["#apiHealthBadge .footer-dot", "backgroundColor"],
        ]);
        const dot = ratios.pop();
        for (const r of ratios)
          expect(r.ratio, `${theme} ${r.selector}`).toBeGreaterThanOrEqual(4.5);
        expect(dot.ratio, `${theme} status dot`).toBeGreaterThanOrEqual(3);
      });
    }
  });

  test("the logo fits its wordmark, so the environment tag sits beside the name", async ({
    page,
  }) => {
    await gotoApp(page);
    await page.evaluate(() => document.fonts.ready);
    const fit = await page.evaluate(() => {
      const svg = document.querySelector(".stackr-logo");
      const box = svg.getBBox();
      const viewBoxWidth = svg.viewBox.baseVal.width;
      const drawnRight = [...svg.querySelectorAll("text")]
        .map((t) => t.getBoundingClientRect())
        .filter((r) => r.width > 0)
        .reduce((max, r) => Math.max(max, r.right), 0);
      return {
        clipped: box.x + box.width > viewBoxWidth,
        trimmed: viewBoxWidth < 480,
        tagGap: document.getElementById("envBadge").getBoundingClientRect().left - drawnRight,
      };
    });
    expect(fit.clipped).toBe(false);
    expect(fit.trimmed).toBe(true);
    expect(fit.tagGap).toBeGreaterThanOrEqual(0);
    expect(fit.tagGap).toBeLessThanOrEqual(32);
  });

  test("at phone width the footer and the environment tag keep 12px text", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page);
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "#envBadge, .app-footer .footer-link, #apiHealthLabel, #apiHealthValue, .footer-meta, .footer-thanks"
        ),
      ]
        .filter((el) => el.offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 12)
        .map((el) => `${el.id || el.textContent.trim()}: ${getComputedStyle(el).fontSize}`)
    );
    expect(small).toEqual([]);
  });

  test("at phone width the longest footer status wraps by whole parts inside the footer", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page);
    const faults = await page.evaluate(() => {
      _renderFooterStatus("down", false, "Market unavailable · Spot unavailable");
      const footer = document.querySelector(".app-footer").getBoundingClientRect();
      return [...document.querySelectorAll("#apiHealthBadge > span:not(.footer-dot)")].flatMap(
        (el) => {
          const lines = new Set([...el.getClientRects()].map((r) => Math.round(r.top))).size;
          const range = document.createRange();
          range.selectNodeContents(el);
          const textLines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
          const out = [];
          if (el.getBoundingClientRect().right > footer.right - 1) out.push(`${el.id} overflows`);
          if (Math.max(lines, textLines) > 1) out.push(`${el.id} breaks across lines`);
          return out;
        }
      );
    });
    expect(faults).toEqual([]);

    const versionMiddles = await page.evaluate(() =>
      [".footer-version .footer-sep", "#versionBadge"].map((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return Math.round(r.top + r.height / 2);
      })
    );
    expect(versionMiddles[0]).toBe(versionMiddles[1]);
  });
});

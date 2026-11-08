// Keyboard focus ring measured in the page, for focus indicator tests.

import { expect } from "@playwright/test";

export const FOCUS_RING_MIN_CONTRAST = 3;

/**
 * Turns CSS transitions off so a colour read after a theme switch holds the new theme's value.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @returns {Promise<void>}
 */
export async function disableTransitions(page) {
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
}

/**
 * Focuses a control while the page is in keyboard modality, so :focus-visible matches.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {import('@playwright/test').Locator} locator - Control to focus.
 * @returns {Promise<void>}
 */
export async function focusByKeyboard(page, locator) {
  await page.keyboard.press("Tab");
  await locator.focus();
  await expect(locator).toBeFocused();
}

/**
 * Reads the outline of the focused element and its WCAG contrast against the surface the
 * ring is drawn on (the element's ancestors, flattened onto the first opaque fill).
 * @param {import('@playwright/test').Locator} locator - Focused control.
 * @returns {Promise<{visible: boolean, style: string, width: number, ratio: number}>} Ring facts.
 */
export function readFocusRing(locator) {
  return locator.evaluate((node) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const toRgba = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const luminance = ([r, g, b]) =>
      0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
    const tints = [];
    let base = [255, 255, 255, 255];
    for (let up = node.parentElement; up; up = up.parentElement) {
      const fill = toRgba(getComputedStyle(up).backgroundColor);
      if (fill[3] === 255) {
        base = fill;
        break;
      }
      if (fill[3] > 0) tints.push(fill);
    }
    const surface = tints.reduceRight((under, tint) => {
      const a = tint[3] / 255;
      return [0, 1, 2].map((i) => a * tint[i] + (1 - a) * under[i]).concat(255);
    }, base);
    const cs = getComputedStyle(node);
    const ring = toRgba(cs.outlineColor);
    const [hi, lo] = [luminance(ring), luminance(surface)].sort((x, y) => y - x);
    return {
      visible: node.matches(":focus-visible"),
      style: cs.outlineStyle,
      width: parseFloat(cs.outlineWidth),
      ratio: (hi + 0.05) / (lo + 0.05),
    };
  });
}

/**
 * Asserts the shared Collections ring on the focused control: a solid 2px outline of at
 * least 3:1 against the surface behind it.
 * @param {import('@playwright/test').Locator} locator - Focused control.
 * @param {string} what - Name for the failure message.
 * @returns {Promise<void>}
 */
export async function expectFocusRing(locator, what) {
  const ring = await readFocusRing(locator);
  expect(ring.visible, `${what} matches :focus-visible`).toBe(true);
  expect(ring.style, `${what} outline style`).toBe("solid");
  expect(ring.width, `${what} outline width`).toBe(2);
  expect(ring.ratio, `${what} ring contrast`).toBeGreaterThanOrEqual(FOCUS_RING_MIN_CONTRAST);
}

// WCAG text contrast measured in the page, for theme colour tests.

import { expect } from "@playwright/test";

export const THEMES = ["light", "dark", "slate", "sepia"];
export const AA_NORMAL_TEXT = 4.5;

/**
 * Returns { text, color, background, inlineColor, ratio } for each selector match: the computed
 * text colour and its WCAG 2.x contrast over the element's background composited onto the
 * nearest opaque ancestor. Over a gradient (its own or an ancestor below that surface) the
 * ratio is the lowest across the colour stops. The element's own opacity fades its fill and text as
 * one layer; with `ancestorOpacity`, so does each ancestor below that surface, so a dimmed cell counts.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {string} selector - CSS selector for the text elements to measure.
 * @param {{ancestorOpacity?: boolean}} [options] - Measure options.
 * @returns {Promise<Array<Object>>} One record per matched element.
 */
export function measureText(page, selector, { ancestorOpacity = false } = {}) {
  return page.evaluate(
    ({ sel, withAncestors }) => {
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
      const over = (top, base) => {
        const a = top[3] / 255;
        return [0, 1, 2].map((i) => a * top[i] + (1 - a) * base[i]);
      };
      const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const luminance = ([r, g, b]) =>
        0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
      const mix = (top, base, a) => [0, 1, 2].map((i) => a * top[i] + (1 - a) * base[i]);
      // Walks up from `from` to the first opaque surface. A faded opaque surface fades text and
      // surface together, so `flatten` composites a colour painted on it over its own backdrop.
      // `colour` is that surface with every translucent fill between it and `from` laid on top.
      const walk = (from, start) => {
        let opacity = start;
        const tints = [];
        const lay = (base) => tints.reduceRight((under, tint) => [...over(tint, under), 255], base);
        for (let node = from.parentElement; node; node = node.parentElement) {
          const cs = getComputedStyle(node);
          const c = toRgba(cs.backgroundColor);
          const own = withAncestors ? Number(cs.opacity) : 1;
          if (c[3] === 255) {
            if (own === 1) return { colour: lay(c), opacity, flatten: (x) => x };
            const behind = walk(node, own);
            const flatten = (x) => behind.flatten(mix(x, behind.colour, behind.opacity));
            return { colour: lay(c), opacity, flatten };
          }
          if (c[3] > 0) tints.push(c);
          opacity *= own;
        }
        return { colour: lay([255, 255, 255, 255]), opacity, flatten: (x) => x };
      };
      const STOP = /(?:rgba?|oklch|oklab|lab|lch|color)\([^()]*\)/g;
      // Colour stops of the first gradient between the element and its first opaque fill.
      const gradientStops = (el) => {
        for (let node = el; node; node = node.parentElement) {
          const cs = getComputedStyle(node);
          const stops = cs.backgroundImage.match(STOP);
          if (stops) return stops.map(toRgba);
          if (toRgba(cs.backgroundColor)[3] === 255) return [];
        }
        return [];
      };
      const contrast = (a, b) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      return Array.from(document.querySelectorAll(sel)).map((el) => {
        const cs = getComputedStyle(el);
        const surface = walk(el, 1);
        // Opacity fades the element as one layer, fill and text together, over the surface.
        const fade = Number(cs.opacity) * surface.opacity;
        const faded = (x) => surface.flatten(mix(x, surface.colour, fade));
        const text = toRgba(cs.color);
        const local = over(toRgba(cs.backgroundColor), surface.colour);
        const back = faded(local);
        const fore = faded(over(text, local));
        const stops = gradientStops(el).map((stop) => {
          const base = over(stop, surface.colour);
          return contrast(faded(base), faded(over(text, base)));
        });
        return {
          text: el.textContent.trim(),
          color: cs.color,
          background: `rgb(${back.map(Math.round).join(", ")})`,
          inlineColor: el.style.color,
          ratio: stops.length ? Math.min(...stops) : contrast(back, fore),
        };
      });
    },
    { sel: selector, withAncestors: ancestorOpacity }
  );
}

/**
 * Lists each named text below AA, carrying an inline colour, or not rendered at all.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {Object<string,string>} selectors - Map of a readable name to a CSS selector.
 * @param {{ancestorOpacity?: boolean}} [options] - Passed to measureText.
 * @returns {Promise<string[]>} One line per failure; empty when every text passes.
 */
/**
 * Switches the app theme and waits until the root element carries it.
 * @param {import("@playwright/test").Page} page - Playwright page.
 * @param {string} theme - One of THEMES.
 */
export async function applyTheme(page, theme) {
  await page.evaluate((name) => window.setTheme(name), theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

export async function contrastFailures(page, selectors, options = {}) {
  const failures = [];
  for (const [what, selector] of Object.entries(selectors)) {
    // An empty node has no text to read.
    const records = (await measureText(page, selector, options)).filter((r) => r.text !== "");
    if (!records.length) failures.push(`${what}: nothing rendered`);
    for (const r of records) {
      if (r.ratio < AA_NORMAL_TEXT) failures.push(`${what} "${r.text}" ${r.ratio.toFixed(2)}:1`);
      if (r.inlineColor) failures.push(`${what} "${r.text}" inline ${r.inlineColor}`);
    }
  }
  return failures;
}

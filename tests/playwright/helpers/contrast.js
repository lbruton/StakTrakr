// WCAG text contrast measured in the page, for theme colour tests.

export const THEMES = ["light", "dark", "slate", "sepia"];
export const AA_NORMAL_TEXT = 4.5;

/**
 * Returns { text, color, background, inlineColor, ratio } for each selector match: the computed
 * text colour and its WCAG 2.x contrast over the element's background composited onto the
 * nearest opaque ancestor. The text colour is faded by the element's own opacity; with
 * `ancestorOpacity`, also by each ancestor below that surface, so a dimmed parent cell counts.
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
      // Opacity above the opaque surface fades text and surface together, so the walk stops there.
      const surfaceBehind = (el) => {
        let opacity = Number(getComputedStyle(el).opacity);
        for (let node = el.parentElement; node; node = node.parentElement) {
          const cs = getComputedStyle(node);
          const c = toRgba(cs.backgroundColor);
          if (c[3] === 255) return { colour: c, opacity };
          if (withAncestors) opacity *= Number(cs.opacity);
        }
        return { colour: [255, 255, 255, 255], opacity };
      };
      return Array.from(document.querySelectorAll(sel)).map((el) => {
        const cs = getComputedStyle(el);
        const surface = surfaceBehind(el);
        const back = over(toRgba(cs.backgroundColor), surface.colour);
        const text = toRgba(cs.color);
        text[3] *= surface.opacity;
        const fore = over(text, back);
        const [hi, lo] = [luminance(back), luminance(fore)].sort((a, b) => b - a);
        return {
          text: el.textContent.trim(),
          color: cs.color,
          background: `rgb(${back.map(Math.round).join(", ")})`,
          inlineColor: el.style.color,
          ratio: (hi + 0.05) / (lo + 0.05),
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

/**
 * Phone-width floors for one surface: text under 12px, inputs under 16px, and controls
 * whose 44px hit area is short or overlaps a neighbor.
 *
 * A point is a hit when elementFromPoint lands on the control, inside it, or on its label.
 * The hit box is the run of hit pixels through the center on each axis; under 44px fails.
 * A 3x3 grid 21px either side of the center catches a neighbor that covers the control.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {string} rootSelector - CSS selector of the surface root.
 * @param {string} [extraControls] - Selector for clickable elements that carry no control role.
 * @returns {Promise<{tested:number, smallText:string[], smallInputs:string[], smallTargets:string[]}>}
 */
export async function readPhoneFloors(page, rootSelector, extraControls = "") {
  const root = page.locator(rootSelector);
  // An opening fade reads as hidden to checkVisibility, so finite animations finish first.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => null))
    )
  );
  return root.evaluate((root, extraControls) => {
    const shown = (el) =>
      el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
      !el.closest(".sr-only") &&
      !el.closest("[aria-hidden='true']");
    const name = (el) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${
        typeof el.className === "string" && el.className.trim()
          ? `.${el.className.trim().split(/\s+/).join(".")}`
          : ""
      }`;

    const smallText = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!walker.currentNode.textContent.trim() || !el || !shown(el)) continue;
      if (el.closest("option, svg")) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) smallText.add(`${name(el)} ${size}px`);
    }

    const fields = [
      ...root.querySelectorAll(
        "input:not([type='checkbox']):not([type='radio']):not([type='file']):not([type='range']):not([type='color']), select, textarea"
      ),
    ].filter(shown);
    const smallInputs = fields
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${name(el)} ${getComputedStyle(el).fontSize}`);

    const controls = [
      ...root.querySelectorAll(
        "button, a[href], select, input:not([type='hidden']), textarea, summary, [role='button'], [role='tab'], [tabindex='0']" +
          (extraControls ? `, ${extraControls}` : "")
      ),
    ].filter(shown);
    const accepts = (el, hit) => {
      if (!hit) return false;
      if (hit === el || el.contains(hit)) return true;
      const labels = [...(el.labels || [])];
      const wrap = el.closest("label");
      if (wrap) labels.push(wrap);
      return labels.some((label) => label === hit || label.contains(hit));
    };
    const smallTargets = [];
    let tested = 0;
    for (const el of controls) {
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) continue;
      tested++;
      const [x0, y0] = [Math.floor(cx), Math.floor(cy)];
      const hits = (x, y) => accepts(el, document.elementFromPoint(x, y));
      // Hit pixels past the center in one direction, up to the 22 a 44px box needs.
      const run = (dx, dy) => {
        let n = 0;
        while (n < 22 && hits(x0 + dx * (n + 1), y0 + dy * (n + 1))) n++;
        return n;
      };
      // Hit testing snaps a fractional box to whole pixels, so a run that covers the
      // control's own box within 1px counts as that box's exact size.
      const extent = (hit, size) => (hit >= size - 1 ? Math.max(hit, size) : hit);
      const centered = hits(x0, y0);
      const across = centered ? extent(run(-1, 0) + run(1, 0) + 1, r.width) : 0;
      const down = centered ? extent(run(0, -1) + run(0, 1) + 1, r.height) : 0;
      if (across < 44 || down < 44) {
        smallTargets.push(
          `${name(el)} ${Math.round(r.width)}x${Math.round(r.height)} hit box ${Math.round(across)}x${Math.round(down)}`
        );
        continue;
      }
      const steps = [-21, 0, 21];
      const points = steps.flatMap((dx) => steps.map((dy) => [cx + dx, cy + dy]));
      const blockers = points
        .map(([x, y]) => document.elementFromPoint(x, y))
        .filter((hit) => !accepts(el, hit))
        .map((hit) => (hit ? name(hit) : "nothing"));
      if (blockers.length) {
        smallTargets.push(
          `${name(el)} ${Math.round(r.width)}x${Math.round(r.height)} misses on ${[...new Set(blockers)].join(", ")}`
        );
      }
    }
    return { tested, smallText: [...smallText], smallInputs, smallTargets };
  }, extraControls);
}

/**
 * Phone-width floors for one surface: text under 12px, inputs under 16px, and controls
 * whose 44px hit area misses or overlaps a neighbour.
 *
 * The hit check samples a 3x3 grid 21px either side of each control's centre with
 * elementFromPoint. A point counts when it lands on the control, inside it, or on its label,
 * so a smaller box, a short ::after, or a neighbour's hit area all show as a miss.
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
      const points = [-21, 0, 21].flatMap((dx) => [-21, 0, 21].map((dy) => [cx + dx, cy + dy]));
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
